# cloudkv

[![CI](https://github.com/samuelcolvin/cloudkv/actions/workflows/ci.yml/badge.svg)](https://github.com/samuelcolvin/cloudkv/actions?query=event%3Apush+branch%3Amain+workflow%3ACI)
[![pypi](https://img.shields.io/pypi/v/cloudkv.svg)](https://pypi.python.org/pypi/cloudkv)
[![versions](https://img.shields.io/pypi/pyversions/cloudkv.svg)](https://github.com/samuelcolvin/cloudkv)
[![license](https://img.shields.io/github/license/samuelcolvin/cloudkv.svg)](https://github.com/samuelcolvin/cloudkv/blob/main/LICENSE)

key/value store based on Cloudflare workers, with a Python client.

By default the `cloudkv` Python package connects to [cloudkv.samuelcolvin.workers.dev](https://cloudkv.samuelcolvin.workers.dev) but you can deploy an instance to your own cloudflare worker if you prefer. Code for the server is in [./cf-worker](https://github.com/samuelcolvin/cloudkv/tree/main/cf-worker).

Some reasons you might use cloudkv:
* Zero DB setup or account required, just create a namespace with the CLI and get started
* Sync and async clients with almost identical APIs
* Completely open source, deploy your own cloudflare worker if you like or used the hosted one
* Pydantic integration to retrieve values as virtually and Python type
* View any value via it's URL

## Installation

```bash
uv add cloudkv
```

(or `pip install cloudkv` if you're old school)

## Usage

cloudkv stores key-value pairs in a Cloudflare worker using KV storage and D1.

To create a namespace, run

```bash
uvx cloudkv
```

Which should create a namespace and print the keys to use:

```
creating namespace...
Namespace created successfully.

cloudkv_read_token = '***'
cloudkv_write_token = '******'
```

_(You can also create a namespace programmatically, see `create_namespace` below)_

### Sync API

With a namespace created, you can connect thus:

```py
from cloudkv import SyncCloudKV

cloudkv_read_token = '***'
cloudkv_write_token = '******'
kv = SyncCloudKV(cloudkv_read_token, cloudkv_write_token)
url = kv.set('foo', 'bar')
print(url)
#> https://cloudkv.samuelcolvin.workers.dev/***/foo
print(kv.get('foo'))
#> b'bar'
print(kv.get_as('foo', str))
#> 'bar'
```

Storing structured and retrieving data:

```py
from dataclasses import dataclass
from cloudkv import SyncCloudKV

cloudkv_read_token = '***'
cloudkv_write_token = '******'

@dataclass
class Foo:
    bar: float
    spam: list[dict[str, tuple[int, bytes]]]

kv = SyncCloudKV(cloudkv_read_token, cloudkv_write_token)
foo = Foo(1.23, [{'spam': (1, b'eggs')}])
url = kv.set('foo', foo)
print(url)
#> https://cloudkv.samuelcolvin.workers.dev/***/foo
print(kv.get('foo'))
#> b'{"bar":1.23,"spam":[{"spam":[1,"eggs"]}]}'
print(kv.get_as('foo', Foo))
#> Foo(bar=1.23, spam=[{'spam': (1, b'eggs')}])
```

### Async API

You can also connect with the async client.

The sync and async client's have an identical API except `AsyncCloudKV` must be used as an async context manager,
while `SyncCloudKV` can optionally be used as a context manager or directly after being initialised.

```py
import asyncio
from cloudkv import AsyncCloudKV

cloudkv_read_token = '***'
cloudkv_write_token = '******'

async def main():
    async with AsyncCloudKV.create(cloudkv_read_token, cloudkv_write_token) as kv:
        await kv.set('foo', 'bar')
        print(await kv.get('foo'))
        #> bar

asyncio.run(main())
```

### API

`SyncCloudKV` has the follow methods.

_(`AsyncCloudKV` has identical methods except they're async and it must be used as an async context manager)_

```py
class SyncCloudKV:
    """Sync client for cloudkv.

    This client can be used either directly after initialization or as a context manager.
    """
    namespace_read_token: str
    """Key used to get values and list keys."""
    namespace_write_token: str | None
    """Key required to set and delete keys."""
    base_url: str
    """Base URL to connect to."""

    def __init__(self, read_token: str, write_token: str | None, *, base_url: str = ...):
        """Initialize a new sync client.

        Args:
            read_token: Read API key for the namespace.
            write_token: Write API key for the namespace, maybe unset if you only have permission to read values
                and list keys.
            base_url: Base URL to connect to.
        """

    @classmethod
    def create_namespace(cls, *, base_url: str = ...) -> CreateNamespaceDetails:
        """Create a new namespace, and return details of it.

        Args:
            base_url: Base URL to connect to.

        Returns:
            `CreateNamespaceDetails` instance with details of the namespace.
        """

    def __enter__(self): ...

    def __exit__(self, *args): ...

    def get(self, key: str) -> bytes | None:
        """Get a value from its key.

        Args:
            key: key to lookup

        Returns:
            Value as bytes, or `None` if the key does not exist.
        """

    def get_content_type(self, key: str) -> tuple[bytes | None, str | None]:
        """Get a value and content-type from a key.

        Args:
            key: key to lookup

        Returns:
            Value as tuple of `(value, content_type)`, value will be `None` if the key does not exist,
            `content_type` will be `None` if the key doesn't exist, or no content-type is set on the key.
        """

    def get_as(self, key: str, return_type: type[T], *, default: D = None, force_validate: bool = False) -> T | D:
        '''Get a value as the given type, or fallback to the `default` value if the value does not exist.

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
        '''

    def set(
        self,
        key: str,
        value: _typing.Any,
        *,
        content_type: str | None = None,
        expires: int | timedelta | None = None,
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
        return self.set_details(key, value, content_type=content_type, expires=expires).url

    def set_details(
        self,
        key: str,
        value: _typing.Any,
        *,
        content_type: str | None = None,
        expires: int | timedelta | None = None,
    ) -> KeyInfo:
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

    def delete(self, key: str) -> bool:
        """Delete a key.

        Args:
            key: The key to delete.

        Returns:
            True if the key was deleted, False otherwise.
        """

    def keys(
        self,
        *,
        starts_with: str | None = None,
        ends_with: str | None = None,
        contains: str | None = None,
        like: str | None = None,
        offset: int | None = None,
    ) -> list[KeyInfo]:
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
```

Types shown above have the following structure:

```py
class CreateNamespaceDetails(pydantic.BaseModel):
    base_url: str
    """Base URL of the namespace"""
    read_token: str
    """Read API key for the namespace"""
    write_token: str
    """Write API key for the namespace"""
    created_at: datetime
    """Creation timestamp of the namespace"""


class KeyInfo(pydantic.BaseModel):
    url: str
    """URL of the key/value"""
    key: str
    """The key"""
    content_type: str | None
    """Content type set in the datastore"""
    size: int
    """Size of the value in bytes"""
    created_at: datetime
    """Creation timestamp of the key/value"""
    expiration: datetime
    """Expiration timestamp of the key/value"""
```
