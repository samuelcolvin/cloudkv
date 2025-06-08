import pytest
from dirty_equals import HasLen, IsList, IsStr

from cloudkv import SyncCloudKV

from .conftest import IsDatetime, IsNow

pytestmark = pytest.mark.anyio


def test_init():
    kv = SyncCloudKV('read', 'write')
    assert kv.namespace_read_token == 'read'
    assert kv.namespace_write_token == 'write'


def test_create_namespace(server: str):
    create_details = SyncCloudKV.create_namespace(base_url=server)
    assert create_details.model_dump() == {
        'read_token': IsStr() & HasLen(24),
        'write_token': IsStr() & HasLen(48),
        'created_at': IsNow(),
        'base_url': 'http://localhost:8787',
    }


def test_get_set(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()

    url = kv.set('test_token', 'test_value')
    assert url == f'{server}/{kv.namespace_read_token}/test_token'
    assert kv.get('test_token') == b'test_value'


def test_get_as(server: str):
    with SyncCloudKV.create_namespace(base_url=server).sync_client() as kv:
        kv.set('list_of_ints', [1, 2, 3])
        assert kv.get_as('list_of_ints', list[int]) == [1, 2, 3]


def test_tokens(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()

    kv.set('test_token', 'test_value')
    kv.set('list_of_ints', [1, 2, 3])
    keys = kv.keys()
    assert [k.key for k in keys] == IsList('test_token', 'list_of_ints', check_order=False)

    keys = kv.keys(starts_with='test')
    assert [k.model_dump() for k in keys] == [
        {
            'url': f'{kv.base_url}/{kv.namespace_read_token}/test_token',
            'key': 'test_token',
            'content_type': 'text/plain',
            'size': 10,
            'created_at': IsNow(),
            'expiration': IsDatetime(),
        }
    ]


def test_delete(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()

    kv.set('test_token', 'test_value')
    assert kv.get('test_token') == b'test_value'

    assert [k.key for k in kv.keys()] == ['test_token']

    kv.delete('test_token')

    assert kv.get('test_token') is None
    assert [k.key for k in kv.keys()] == []


def test_read_only(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()

    kv.set('test_token', 'test_value')
    assert kv.get('test_token') == b'test_value'

    kv_readonly = SyncCloudKV(kv.namespace_read_token, None, base_url=kv.base_url)
    assert kv_readonly.get('test_token') == b'test_value'

    with pytest.raises(RuntimeError, match="Namespace write key not provided, can't set"):
        kv_readonly.set('test_token', 'test_value')
