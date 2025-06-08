import pytest
from dirty_equals import HasLen, IsStr, IsStrictDict

from cloudkv import AsyncCloudKV

from .conftest import IsDatetime, IsNow

pytestmark = pytest.mark.anyio


async def test_create_namespace(server: str):
    create_details = await AsyncCloudKV.create_namespace(base_url=server)
    assert create_details.model_dump() == IsStrictDict(
        base_url='http://localhost:8787',
        read_token=IsStr() & HasLen(24),
        write_token=IsStr() & HasLen(48),
        created_at=IsNow(),
    )


async def test_get_set_tokens(server: str):
    create_details = await AsyncCloudKV.create_namespace(base_url=server)

    async with create_details.async_client() as kv:
        url = await kv.set('test_token', 'test_value')
        assert url == f'{server}/{create_details.read_token}/test_token'
        assert await kv.get('test_token') == b'test_value'

        keys = await kv.keys()
        assert [k.model_dump() for k in keys] == [
            {
                'url': f'{server}/{create_details.read_token}/test_token',
                'key': 'test_token',
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
        await kv.set('test_token', 'test_value')
        assert await kv.get('test_token') == b'test_value'
        keys = await kv.keys()
        assert [k.key for k in keys] == ['test_token']

        await kv.delete('test_token')
        assert await kv.get('test_token') is None
        keys = await kv.keys()
        assert [k.key for k in keys] == []


async def test_read_only(server: str):
    create_details = await AsyncCloudKV.create_namespace(base_url=server)
    async with create_details.async_client() as kv:
        await kv.set('test_token', 'test_value')
        assert await kv.get('test_token') == b'test_value'

    async with AsyncCloudKV(create_details.read_token, None, base_url=server) as kv_readonly:
        assert await kv_readonly.get('test_token') == b'test_value'

        with pytest.raises(RuntimeError, match="Namespace write key not provided, can't set"):
            await kv_readonly.set('test_token', 'test_value')
