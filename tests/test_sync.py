from datetime import timedelta

import pytest
from dirty_equals import HasLen, IsList, IsStr

from cloudkv import SyncCloudKV, shared

from .conftest import IsDatetime, IsNow

pytestmark = pytest.mark.anyio


def test_init():
    kv = SyncCloudKV('read', 'write', base_url='https://example.com/')
    assert kv.namespace_read_token == 'read'
    assert kv.namespace_write_token == 'write'
    assert kv.base_url == 'https://example.com'


def test_create_namespace(server: str):
    create_details = SyncCloudKV.create_namespace(base_url=server)
    assert create_details.model_dump() == {
        'base_url': server,
        'read_token': IsStr() & HasLen(24),
        'write_token': IsStr() & HasLen(48),
        'created_at': IsNow(),
    }


def test_get_set(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()

    url = kv.set('test_key', 'test_value')
    assert url == f'{server}/{kv.namespace_read_token}/test_key'
    assert kv.get('test_key') == b'test_value'


def test_get_as(server: str):
    with SyncCloudKV.create_namespace(base_url=server).sync_client() as kv:
        kv.set('list_of_ints', [1, 2, 3])
        assert kv.get_as('list_of_ints', list[int]) == [1, 2, 3]


def test_keys(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()

    kv.set('test_key', 'test_value')
    kv.set('list_of_ints', [1, 2, 3])
    keys = kv.keys()
    assert [k.key for k in keys] == IsList('test_key', 'list_of_ints', check_order=False)

    keys = kv.keys(starts_with='test')
    assert [k.model_dump() for k in keys] == [
        {
            'url': f'{kv.base_url}/{kv.namespace_read_token}/test_key',
            'key': 'test_key',
            'content_type': 'text/plain',
            'size': 10,
            'created_at': IsNow(),
            'expiration': IsDatetime(),
        }
    ]


def test_delete(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()

    kv.set('test_key', b'test_value')
    assert kv.get('test_key') == b'test_value'

    keys = kv.keys()
    assert [k.key for k in keys] == ['test_key']
    assert [k.content_type for k in keys] == [None]

    kv.delete('test_key')

    assert kv.get('test_key') is None
    assert [k.key for k in kv.keys()] == []


def test_read_only(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()

    kv.set('test_key', 'test_value')
    assert kv.get('test_key') == b'test_value'

    kv_readonly = SyncCloudKV(kv.namespace_read_token, None, base_url=kv.base_url)
    assert kv_readonly.get('test_key') == b'test_value'

    with pytest.raises(RuntimeError, match="Namespace write key not provided, can't set"):
        kv_readonly.set('test_key', 'test_value')

    with pytest.raises(RuntimeError, match="Namespace write key not provided, can't delete"):
        kv_readonly.delete('test_key')


def test_expires(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()
    kv.set('test_key', 'test_value', expires=123)

    keys = kv.keys()
    assert len(keys) == 1

    key = keys[0]
    assert (key.expiration - key.created_at).total_seconds() == 123

    kv.set('test_key2', 'test_value', expires=timedelta(seconds=42))

    keys = kv.keys(like='test_key2')
    assert len(keys) == 1
    key = keys[0]
    assert (key.expiration - key.created_at).total_seconds() == 60


def test_invalid_tokens(server: str):
    kv = SyncCloudKV('0' * 24, 'bar', base_url=server)

    with pytest.raises(shared.ResponseError, match='Unexpected 404 response: Namespace does not exist'):
        kv.set('test_key', 'test_value')
