from __future__ import annotations as _annotations

import typing

import httpx

from . import _shared

__all__ = ('SyncCloudKV',)


class SyncCloudKV:
    namespace_read_key: str
    namespace_write_key: str | None
    base_url: str
    _client: httpx.Client | None = None

    def __init__(self, read_key: str, write_key: str | None, *, base_url: str = _shared.DEFAULT_BASE_URL):
        self.namespace_read_key = read_key
        self.namespace_write_key = write_key
        self.base_url = base_url

    @classmethod
    def create_namespace(cls, *, base_url: str = _shared.DEFAULT_BASE_URL) -> _shared.CreateResponse:
        response = httpx.post(f'{base_url}/create')
        _shared.ResponseError.check(response)
        return _shared.CreateResponse.model_validate_json(response.content)

    def __enter__(self):
        self._client = httpx.Client()
        self._client.__enter__()
        return self

    def __exit__(self, *args: typing.Any):
        assert self._client is not None
        self._client.__exit__(*args)

    def get(self, key: str) -> bytes | None:
        assert key, 'Key cannot be empty'
        response = self.client.get(f'{self.base_url}/{self.namespace_read_key}/{key}')
        _shared.ResponseError.check(response)
        if response.status_code == 244:
            return None
        else:
            return response.content

    def set(self, key: str, value: str, *, content_type: str | None = None, ttl: int | None = None) -> None:
        if not self.namespace_write_key:
            raise RuntimeError("Namespace write key not provided, can't set keys")
        headers: dict[str, str] = {'authorization': self.namespace_write_key}
        if content_type is not None:
            headers['Content-Type'] = content_type
        if ttl is not None:
            headers['TTL'] = str(ttl)
        response = self.client.post(f'{self.base_url}/{self.namespace_read_key}/{key}', content=value, headers=headers)
        _shared.ResponseError.check(response)

    def delete(self, key: str) -> bool:
        if not self.namespace_write_key:
            raise RuntimeError("Namespace write key not provided, can't delete keys")
        headers: dict[str, str] = {'authorization': self.namespace_write_key}
        response = self.client.delete(f'{self.base_url}/{self.namespace_read_key}/{key}', headers=headers)
        _shared.ResponseError.check(response)
        return response.status_code == 200

    @typing.overload
    def keys(self, *, offset: int | None = None) -> list[_shared.Key]: ...
    @typing.overload
    def keys(self, *, starts_with: str, offset: int | None = None) -> list[_shared.Key]: ...
    @typing.overload
    def keys(self, *, ends_with: str, offset: int | None = None) -> list[_shared.Key]: ...
    @typing.overload
    def keys(self, *, contains: str, offset: int | None = None) -> list[_shared.Key]: ...
    @typing.overload
    def keys(self, *, like: str, offset: int | None = None) -> list[_shared.Key]: ...

    def keys(
        self,
        *,
        starts_with: str | None = None,
        ends_with: str | None = None,
        contains: str | None = None,
        like: str | None = None,
        offset: int | None = None,
    ) -> list[_shared.Key]:
        params = _shared.keys_query_params(starts_with, ends_with, contains, like, offset)

        response = self.client.get(f'{self.base_url}/{self.namespace_read_key}', params=params)
        _shared.ResponseError.check(response)
        return _shared.KeysResponse.model_validate_json(response.content).keys

    @property
    def client(self) -> httpx.Client:
        if self._client:
            return self._client
        else:
            # this is a typing lie, but one that works niceli
            return httpx  # pyright: ignore[reportReturnType]
