from __future__ import annotations as _annotations

from datetime import datetime
from typing import Any, overload

import httpx
import pydantic

DEFAULT_BASE_URL = 'https://cloudkv.samuelcolvin.workers.dev'


class AsyncCloudKV:
    namespace: str
    base_url: str
    _client: httpx.AsyncClient | None = None

    def __init__(self, namespace: str, *, base_url: str = DEFAULT_BASE_URL):
        self.namespace = namespace
        self.base_url = base_url

    async def create_namespace(self) -> CreateResponse:
        response = await self.client.post(f'{self.base_url}/create')
        ResponseError.check(response)
        return CreateResponse.model_validate_json(response.content)

    async def __aenter__(self):
        self._client = httpx.AsyncClient()
        await self._client.__aenter__()
        return self

    async def __aexit__(self, *args: Any):
        assert self._client is not None
        await self._client.__aexit__(*args)

    async def get(self, key: str) -> bytes | None:
        assert key, 'Key cannot be empty'
        response = await self.client.get(f'{self.base_url}/{self.namespace}/{key}')
        ResponseError.check(response)
        if response.status_code == 244:
            return None
        else:
            return response.content

    async def set(self, key: str, value: str, *, content_type: str | None = None, ttl: int | None = None) -> None:
        headers: dict[str, str] = {}
        if content_type is not None:
            headers['Content-Type'] = content_type
        if ttl is not None:
            headers['TTL'] = str(ttl)
        response = await self.client.post(f'{self.base_url}/{self.namespace}/{key}', content=value, headers=headers)
        ResponseError.check(response)

    @overload
    async def keys(self, *, offset: int | None = None) -> list[Key]: ...
    @overload
    async def keys(self, *, starts_with: str, offset: int | None = None) -> list[Key]: ...
    @overload
    async def keys(self, *, ends_with: str, offset: int | None = None) -> list[Key]: ...
    @overload
    async def keys(self, *, contains: str, offset: int | None = None) -> list[Key]: ...
    @overload
    async def keys(self, *, like: str, offset: int | None = None) -> list[Key]: ...

    async def keys(
        self,
        *,
        starts_with: str | None = None,
        ends_with: str | None = None,
        contains: str | None = None,
        like: str | None = None,
        offset: int | None = None,
    ) -> list[Key]:
        if starts_with is not None:
            like = _escape_like_pattern(starts_with) + '%'
        elif ends_with is not None:
            like = '%' + _escape_like_pattern(ends_with)
        elif contains is not None:
            like = '%' + _escape_like_pattern(contains) + '%'

        params = {'like': like} if like is not None else {}
        if offset is not None:
            params['offset'] = str(offset)

        response = await self.client.get(f'{self.base_url}/{self.namespace}', params=params)
        ResponseError.check(response)
        return KeysResponse.model_validate_json(response.content).keys

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client:
            return self._client
        else:
            raise RuntimeError('Client not initialized')


def _escape_like_pattern(pattern: str) -> str:
    return pattern.replace('%', '\\%').replace('_', '\\_')


class CreateResponse(pydantic.BaseModel):
    namespace: str
    created_at: datetime


class Key(pydantic.BaseModel):
    url: str
    key: str
    content_type: str | None
    size: int
    created_at: datetime
    expiration: datetime


class KeysResponse(pydantic.BaseModel):
    keys: list[Key]


class ResponseError(ValueError):
    @classmethod
    def check(cls, response: httpx.Response) -> None:
        if not response.is_success:
            raise cls(f'Unexpected {response.status_code} response: {response.text}')
