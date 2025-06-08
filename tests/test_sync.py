import pytest
from dirty_equals import HasLen, IsList, IsStr

from cloudkv import SyncCloudKV

from .conftest import IsDatetime, IsNow

pytestmark = pytest.mark.anyio


def test_init():
    kv = SyncCloudKV('read', 'write')
    assert kv.namespace_read_api_key == 'read'
    assert kv.namespace_write_api_key == 'write'


def test_create_namespace(server: str):
    create_details = SyncCloudKV.create_namespace(base_url=server)
    assert create_details.model_dump() == {
        'read_key': IsStr() & HasLen(24),
        'write_key': IsStr() & HasLen(48),
        'created_at': IsNow(),
        'base_url': 'http://localhost:8787',
    }


def test_get_set(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()

    url = kv.set('test_key', 'test_value')
    assert url == f'{server}/{kv.namespace_read_api_key}/test_key'
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
            'url': f'{kv.base_url}/{kv.namespace_read_api_key}/test_key',
            'key': 'test_key',
            'content_type': 'text/plain',
            'size': 10,
            'created_at': IsNow(),
            'expiration': IsDatetime(),
        }
    ]


def test_delete(server: str):
    kv = SyncCloudKV.create_namespace(base_url=server).sync_client()

    kv.set('test_key', 'test_value')
    assert kv.get('test_key') == b'test_value'

    assert [k.key for k in kv.keys()] == ['test_key']

    kv.delete('test_key')

    assert kv.get('test_key') is None
    assert [k.key for k in kv.keys()] == []
