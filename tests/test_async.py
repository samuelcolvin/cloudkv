from datetime import timedelta

import pytest
from dirty_equals import HasLen, IsStr, IsStrictDict

from cloudkv import AsyncCloudKV

from .conftest import IsDatetime, IsNow

pytestmark = pytest.mark.anyio


def test_init():
    kv = AsyncCloudKV('read', 'write', base_url='https://example.com/')
    assert kv.namespace_read_token == 'read'
    assert kv.namespace_write_token == 'write'
    assert kv.base_url == 'https://example.com'

    msg = 'HTTP client not initialized - AsyncCloudKV must be used as an async context manager'
    with pytest.raises(RuntimeError, match=msg):
        kv.client


async def test_create_namespace(server: str):
    create_details = await AsyncCloudKV.create_namespace(base_url=server)
    assert create_details.model_dump() == IsStrictDict(
        base_url=server,
        read_token=IsStr() & HasLen(24),
        write_token=IsStr() & HasLen(48),
        created_at=IsNow(),
    )


async def test_get_set_tokens(server: str):
    create_details = await AsyncCloudKV.create_namespace(base_url=server)

    async with create_details.async_client() as kv:
        url = await kv.set('test_key', 'test_value')
        assert url == f'{server}/{create_details.read_token}/test_key'
        assert await kv.get('test_key') == b'test_value'

        keys = await kv.keys()
        assert [k.model_dump() for k in keys] == [
            {
                'url': f'{server}/{create_details.read_token}/test_key',
                'key': 'test_key',
                'content_type': 'text/plain',
                'size': 10,
                'created_at': IsNow(),
                'expiration': IsDatetime(),
            }
        ]

        await kv.set('list_of_ints', [1, 2, 3])
        assert await kv.get_as('list_of_ints', list[int]) == [1, 2, 3]


async def test_delete(server: str):
    create_details = await AsyncCloudKV.create_namespace(base_url=server)

    async with create_details.async_client() as kv:
        await kv.set('test_key', b'test_value')
        assert await kv.get('test_key') == b'test_value'
        keys = await kv.keys()
        assert [k.key for k in keys] == ['test_key']
        assert [k.content_type for k in keys] == [None]

        await kv.delete('test_key')
        assert await kv.get('test_key') is None
        keys = await kv.keys()
        assert [k.key for k in keys] == []


async def test_read_only(server: str):
    create_details = await AsyncCloudKV.create_namespace(base_url=server)
    async with create_details.async_client() as kv:
        await kv.set('test_key', 'test_value')
        assert await kv.get('test_key') == b'test_value'

    async with AsyncCloudKV(create_details.read_token, None, base_url=server) as kv_readonly:
        assert await kv_readonly.get('test_key') == b'test_value'

        with pytest.raises(RuntimeError, match="Namespace write key not provided, can't set"):
            await kv_readonly.set('test_key', 'test_value')

        with pytest.raises(RuntimeError, match="Namespace write key not provided, can't delete"):
            await kv_readonly.delete('test_key')


async def test_expires(server: str):
    create_details = await AsyncCloudKV.create_namespace(base_url=server)

    async with create_details.async_client() as kv:
        await kv.set('test_key', 'test_value', expires=123)

        keys = await kv.keys()
        assert len(keys) == 1
        key = keys[0]
        assert (key.expiration - key.created_at).total_seconds() == 123

        await kv.set('test_key2', 'test_value', expires=timedelta(seconds=42))

        keys = await kv.keys(like='test_key2')
        assert len(keys) == 1
        key = keys[0]
        assert (key.expiration - key.created_at).total_seconds() == 60
