from __future__ import annotations as _annotations

import typing

import httpx

from . import _shared

__all__ = ('AsyncCloudKV',)
T = typing.TypeVar('T')
D = typing.TypeVar('D')


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
    async def create_namespace(cls, *, base_url: str = _shared.DEFAULT_BASE_URL) -> _shared.CreateNamespaceDetails:
        async with httpx.AsyncClient() as client:
            response = await client.post(f'{base_url}/create')
            _shared.ResponseError.check(response)
            return _shared.CreateNamespaceDetails.model_validate_json(response.content)

    async def __aenter__(self):
        self._client = httpx.AsyncClient()
        await self._client.__aenter__()
        return self

    async def __aexit__(self, *args: typing.Any):
        assert self._client is not None
        await self._client.__aexit__(*args)

    async def get(self, key: str) -> bytes | None:
        value, _ = await self.get_content_type(key)
        return value

    async def get_content_type(self, key: str) -> tuple[bytes | None, str | None]:
        assert key, 'Key cannot be empty'
        response = await self.client.get(f'{self.base_url}/{self.namespace_read_key}/{key}')
        _shared.ResponseError.check(response)
        if response.status_code == 244:
            return None, None
        else:
            return response.content, response.headers.get('Content-Type')

    async def get_as(self, key: str, return_type: type[T], *, default: D = None, force_validate: bool = False) -> T | D:
        data, content_type = await self.get_content_type(key)
        return _shared.decode_value(data, content_type, return_type, default, force_validate)

    async def set(
        self,
        key: str,
        value: T,
        *,
        content_type: str | None = None,
        ttl: int | None = None,
        value_type: type[T] | None = None,
    ) -> str:
        set_response = await self.set_details(key, value, content_type=content_type, ttl=ttl, value_type=value_type)
        return set_response.url

    async def set_details(
        self,
        key: str,
        value: T,
        *,
        content_type: str | None = None,
        ttl: int | None = None,
        value_type: type[T] | None = None,
    ) -> _shared.SetDetails:
        if not self.namespace_write_key:
            raise RuntimeError("Namespace write key not provided, can't set")

        binary_value, inferred_content_type = _shared.encode_value(value, value_type)
        content_type = content_type or inferred_content_type

        headers: dict[str, str] = {'authorization': self.namespace_write_key}
        if content_type is not None:
            headers['Content-Type'] = content_type
        if ttl is not None:
            headers['TTL'] = str(ttl)

        response = await self.client.post(
            f'{self.base_url}/{self.namespace_read_key}/{key}', content=binary_value, headers=headers
        )
        _shared.ResponseError.check(response)
        return _shared.SetDetails.model_validate_json(response.content)

    async def delete(self, key: str) -> bool:
        if not self.namespace_write_key:
            raise RuntimeError("Namespace write key not provided, can't delete")
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
