from __future__ import annotations as _annotations

import typing as _typing

import httpx as _httpx

from . import _utils, shared as _shared

__all__ = ('AsyncCloudKV',)
T = _typing.TypeVar('T')
D = _typing.TypeVar('D')


class AsyncCloudKV:
    """Async client for cloudkv.

    This client must be used as an async context manager to create a database connection.
    """

    namespace_read_token: str
    """Key used to get values and list keys."""
    namespace_write_token: str | None
    """Key required to set and delete keys."""
    base_url: str
    """Base URL to connect to."""
    _client: _httpx.AsyncClient | None = None

    def __init__(self, read_token: str, write_token: str | None, *, base_url: str = _shared.DEFAULT_BASE_URL):
        """Initialize a new async client.

        Args:
            read_token: Read API key for the namespace.
            write_token: Write API key for the namespace, maybe unset if you only have permission to read values
                and list keys.
            base_url: Base URL to connect to.
        """
        self.namespace_read_token = read_token
        self.namespace_write_token = write_token
        while base_url.endswith('/'):
            base_url = base_url[:-1]
        self.base_url = base_url

    @classmethod
    async def create_namespace(cls, *, base_url: str = _shared.DEFAULT_BASE_URL) -> _shared.CreateNamespaceDetails:
        """Create a new namespace, and return details of it.

        Args:
            base_url: Base URL to connect to.

        Returns:
            `CreateNamespaceDetails` instance with details of the namespace.
        """
        async with _httpx.AsyncClient() as client:
            response = await client.post(f'{base_url}/create')
            _shared.ResponseError.check(response)
            return _shared.CreateNamespaceDetails.model_validate_json(response.content)

    async def __aenter__(self):
        self._client = _httpx.AsyncClient()
        await self._client.__aenter__()
        return self

    async def __aexit__(self, *args: _typing.Any):
        assert self._client is not None
        await self._client.__aexit__(*args)

    async def get(self, key: str) -> bytes | None:
        """Get a value from its key.

        Args:
            key: key to lookup

        Returns:
            Value as bytes, or `None` if the key does not exist.
        """
        value, _ = await self.get_content_type(key)
        return value

    async def get_content_type(self, key: str) -> tuple[bytes | None, str | None]:
        """Get a value and content-type from a key.

        Args:
            key: key to lookup

        Returns:
            Value as tuple of `(value, content_type)`, value will be `None` if the key does not exist,
            `content_type` will be `None` if the key doesn't exist, or no content-type is set on the key.
        """
        assert key, 'Key cannot be empty'
        response = await self.client.get(f'{self.base_url}/{self.namespace_read_token}/{key}')
        _shared.ResponseError.check(response)
        if response.status_code == 244:
            return None, None
        else:
            return response.content, response.headers.get('Content-Type')

    async def get_as(self, key: str, return_type: type[T], *, default: D = None, force_validate: bool = False) -> T | D:
        """Get a value as the given type, or fallback to the `default` value if the value does not exist.

        Internally this method uses pydantic to parse the value as JSON if it has the correct content-type,
        "application/json; pydantic".

        Args:
            key: key to lookup
            return_type: type to of data to return, this type is used to perform validation in the raw value.
            default: default value to return if the key does not exist, defaults to None
            force_validate: whether to force validation of the value even if the content-type of the value is not
                "application/json; pydantic".

        Returns:
            The value as the given type, or the default value if the key does not exist.
        """
        data, content_type = await self.get_content_type(key)
        return _utils.decode_value(data, content_type, return_type, default, force_validate)

    async def set(
        self,
        key: str,
        value: _typing.Any,
        *,
        content_type: str | None = None,
        ttl: int | None = None,
    ) -> str:
        """Set a value in the namespace.

        Args:
            key: key to set
            value: value to set
            content_type: content type of the value, defaults depends on the value type
            expires: Time in seconds before the value expires, must be >60 seconds, defaults to `None` meaning the
                key will expire after 10 seconds.

        Returns:
            URL of the set operation.
        """
        set_response = await self.set_details(key, value, content_type=content_type, ttl=ttl)
        return set_response.url

    async def set_details(
        self,
        key: str,
        value: _typing.Any,
        *,
        content_type: str | None = None,
        ttl: int | None = None,
    ) -> _shared.KeyInfo:
        """Set a value in the namespace and return details.

        Args:
            key: key to set
            value: value to set
            content_type: content type of the value, defaults depends on the value type
            expires: Time in seconds before the value expires, must be >60 seconds, defaults to `None` meaning the
                key will expire after 10 seconds.

        Returns:
            Details of the key value pair as `KeyInfo`.
        """
        if not self.namespace_write_token:
            raise RuntimeError("Namespace write key not provided, can't set")

        binary_value, inferred_content_type = _utils.encode_value(value)
        content_type = content_type or inferred_content_type

        headers: dict[str, str] = {'authorization': self.namespace_write_token}
        if content_type is not None:
            headers['Content-Type'] = content_type
        if ttl is not None:
            headers['TTL'] = str(ttl)

        response = await self.client.post(
            f'{self.base_url}/{self.namespace_read_token}/{key}', content=binary_value, headers=headers
        )
        _shared.ResponseError.check(response)
        return _shared.KeyInfo.model_validate_json(response.content)

    async def delete(self, key: str) -> bool:
        """Delete a key.

        Args:
            key: The key to delete.

        Returns:
            True if the key was deleted, False otherwise.
        """
        if not self.namespace_write_token:
            raise RuntimeError("Namespace write key not provided, can't delete")
        headers: dict[str, str] = {'authorization': self.namespace_write_token}
        response = await self.client.delete(f'{self.base_url}/{self.namespace_read_token}/{key}', headers=headers)
        _shared.ResponseError.check(response)
        return response.status_code == 200

    @_typing.overload
    async def keys(self, *, offset: int | None = None) -> list[_shared.KeyInfo]: ...
    @_typing.overload
    async def keys(self, *, starts_with: str, offset: int | None = None) -> list[_shared.KeyInfo]: ...
    @_typing.overload
    async def keys(self, *, ends_with: str, offset: int | None = None) -> list[_shared.KeyInfo]: ...
    @_typing.overload
    async def keys(self, *, contains: str, offset: int | None = None) -> list[_shared.KeyInfo]: ...
    @_typing.overload
    async def keys(self, *, like: str, offset: int | None = None) -> list[_shared.KeyInfo]: ...

    async def keys(
        self,
        *,
        starts_with: str | None = None,
        ends_with: str | None = None,
        contains: str | None = None,
        like: str | None = None,
        offset: int | None = None,
    ) -> list[_shared.KeyInfo]:
        """List keys in the namespace.

        Parameters `starts_with`, `ends_with`, `contains` and `like` are mutually exclusive - you can only used one
        them at a tie.

        Args:
            starts_with: Filter to keys that start with this string.
            ends_with: Filter to keys that end with this string.
            contains: Filter to keys that contain this string.
            like: Filter to keys that match this SQL-like pattern.
            offset: Offset the results by this number of keys.

        Returns:
            A list of keys.
        """
        params = _utils.keys_query_params(starts_with, ends_with, contains, like, offset)

        response = await self.client.get(f'{self.base_url}/{self.namespace_read_token}', params=params)
        _shared.ResponseError.check(response)
        return _shared.KeysResponse.model_validate_json(response.content).keys

    @property
    def client(self) -> _httpx.AsyncClient:
        if self._client:
            return self._client
        else:
            raise RuntimeError('HTTP client not initialized - AsyncCloudKV must be used as an async context manager')
