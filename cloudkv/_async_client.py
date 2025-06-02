from __future__ import annotations as _annotations

import typing

import httpx

from . import _shared

__all__ = ('AsyncCloudKV',)


class AsyncCloudKV:
    namespace_read_key: str
    namespace_write_key: str | None
    base_url: str
    _client: httpx.AsyncClient | None = None

    def __init__(self, read_key: str, write_key: str | None, *, base_url: str = _shared.DEFAULT_BASE_URL):
        self.namespace_read_key = read_key
        self.namespace_write_key = write_key
        self.base_url = base_url

    @classmethod
    async def create_namespace(cls, *, base_url: str = _shared.DEFAULT_BASE_URL) -> _shared.CreateNamespaceResponse:
        async with httpx.AsyncClient() as client:
            response = await client.post(f'{base_url}/create')
            _shared.ResponseError.check(response)
            return _shared.CreateNamespaceResponse.model_validate_json(response.content)

    async def __aenter__(self):
        self._client = httpx.AsyncClient()
        await self._client.__aenter__()
        return self

    async def __aexit__(self, *args: typing.Any):
        assert self._client is not None
        await self._client.__aexit__(*args)

    async def get(self, key: str) -> bytes | None:
        assert key, 'Key cannot be empty'
        response = await self.client.get(f'{self.base_url}/{self.namespace_read_key}/{key}')
        _shared.ResponseError.check(response)
        if response.status_code == 244:
            return None
        else:
            return response.content

    async def set(self, key: str, value: str, *, content_type: str | None = None, ttl: int | None = None) -> str:
        set_response = await self.set_info(key, value, content_type=content_type, ttl=ttl)
        return set_response.url

    async def set_info(
        self, key: str, value: str, *, content_type: str | None = None, ttl: int | None = None
    ) -> _shared.SetResponse:
        if not self.namespace_write_key:
            raise RuntimeError("Namespace write key not provided, can't set keys")
        headers: dict[str, str] = {'authorization': self.namespace_write_key}
        if content_type is not None:
            headers['Content-Type'] = content_type
        if ttl is not None:
            headers['TTL'] = str(ttl)
        response = await self.client.post(
            f'{self.base_url}/{self.namespace_read_key}/{key}', content=value, headers=headers
        )
        _shared.ResponseError.check(response)
        return _shared.SetResponse.model_validate_json(response.content)

    async def delete(self, key: str) -> bool:
        if not self.namespace_write_key:
            raise RuntimeError("Namespace write key not provided, can't delete keys")
        headers: dict[str, str] = {'authorization': self.namespace_write_key}
        response = await self.client.delete(f'{self.base_url}/{self.namespace_read_key}/{key}', headers=headers)
        _shared.ResponseError.check(response)
        return response.status_code == 200

    @typing.overload
    async def keys(self, *, offset: int | None = None) -> list[_shared.Key]: ...
    @typing.overload
    async def keys(self, *, starts_with: str, offset: int | None = None) -> list[_shared.Key]: ...
    @typing.overload
    async def keys(self, *, ends_with: str, offset: int | None = None) -> list[_shared.Key]: ...
    @typing.overload
    async def keys(self, *, contains: str, offset: int | None = None) -> list[_shared.Key]: ...
    @typing.overload
    async def keys(self, *, like: str, offset: int | None = None) -> list[_shared.Key]: ...

    async def keys(
        self,
        *,
        starts_with: str | None = None,
        ends_with: str | None = None,
        contains: str | None = None,
        like: str | None = None,
        offset: int | None = None,
    ) -> list[_shared.Key]:
        params = _shared.keys_query_params(starts_with, ends_with, contains, like, offset)

        response = await self.client.get(f'{self.base_url}/{self.namespace_read_key}', params=params)
        _shared.ResponseError.check(response)
        return _shared.KeysResponse.model_validate_json(response.content).keys

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client:
            return self._client
        else:
            raise RuntimeError('Client not initialized')
