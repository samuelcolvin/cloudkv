# cloudkv

[![CI](https://github.com/samuelcolvin/cloudkv/actions/workflows/ci.yml/badge.svg)](https://github.com/samuelcolvin/cloudkv/actions?query=event%3Apush+branch%3Amain+workflow%3ACI)
[![pypi](https://img.shields.io/pypi/v/cloudkv.svg)](https://pypi.python.org/pypi/cloudkv)
[![versions](https://img.shields.io/pypi/pyversions/cloudkv.svg)](https://github.com/samuelcolvin/cloudkv)
[![license](https://img.shields.io/github/license/samuelcolvin/cloudkv.svg)](https://github.com/samuelcolvin/cloudkv/blob/main/LICENSE)

key/value store based on Cloudflare workers.

By default the `cloudkv` package connects to [cloudkv.samuelcolvin.workers.dev](https://cloudkv.samuelcolvin.workers.dev) but you can deploy an instance to your own cloudflare worker if you prefer. Code for the server is in [./cf-worker](https://github.com/samuelcolvin/cloudkv/tree/docs/cf-worker).

Some reasons you might use cloudkv:
* zero DB setup or account required, just create a namespace with the CLI and get started
* sync and async clients with almost identical APIs
* completely open source, deploy your own cloudflare worker if you like
* Pydantic integration for to retrieve values as virtually and Python type

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

cloudkv_read_key = '***'
cloudkv_write_key = '******'
```

_(You can also create a namespace programmatically, see `create_namespace` below)_

### Sync API

With a namespace created, you can connect thus:

```py
from cloudkv import SyncCloudKV

cloudkv_read_key = '***'
cloudkv_write_key = '******'
kv = SyncCloudKV(cloudkv_read_key, cloudkv_write_key)
kv.set('foo', 'bar')
print(kv.get('foo'))
#> bar
```

### Async API

You can also connect with the async client.

The sync and async client's have an identical API except `AsyncCloudKV` must be used as an async context manager,
while `SyncCloudKV` can optionally be used as a context manager or directly after being initialised.

```py
import asyncio
from cloudkv import AsyncCloudKV

cloudkv_read_key = '***'
cloudkv_write_key = '******'

async def main():
    async with AsyncCloudKV.create(cloudkv_read_key, cloudkv_write_key) as kv:
        await kv.set('foo', 'bar')
        print(await kv.get('foo'))
        #> bar

asyncio.run(main())
```

### API

`SyncCloudKV` has the follow methods.

_(`AsyncCloudKV` has identical methods except they're async it must be used as an async context manager.)_

```py
class SyncCloudKV:
    """Sync client for cloudkv.

    This client can be used either directly after initialization or as a context manager.
    """
    namespace_read_api_key: str
    """Key used to get values and list keys."""
    namespace_write_api_key: str | None
    """Key required to set and delete keys."""
    base_url: str
    """Base URL to connect to."""

    def __init__(self, read_api_key: str, write_api_key: str | None, *, base_url: str = ...):
        """Initialize a new sync client.

        Args:
            read_api_key: Read API key for the namespace.
            write_api_key: Write API key for the namespace, maybe unset if you only have permission to read values
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
        value: T,
        *,
        content_type: str | None = None,
        expires: int | None = None,
        value_type: type[T] | None = None,
    ) -> str:
        """Set a value in the namespace.

        Args:
            key: key to set
            value: value to set
            content_type: content type of the value, defaults depends on the value type
            expires: Time in seconds before the value expires, must be >60 seconds, defaults to `None` meaning the
                key will expire after 10 seconds.
            value_type: type of the value, if set this is used by pydantic to serialize the value

        Returns:
            URL of the set operation.
        """

    def set_details(self, key: str, value: T, *, content_type: str | None = None, expires: int | None = None, value_type: type[T] | None = None) -> SetDetails:
        """Set a value in the namespace and return details.

        Args:
            key: key to set
            value: value to set
            content_type: content type of the value, defaults depends on the value type
            expires: Time in seconds before the value expires, must be >60 seconds, defaults to `None` meaning the
                key will expire after 10 seconds.
            value_type: type of the value, if set this is used by pydantic to serialize the value

        Returns:
            Details of the key value pair as `SetDetails`.
        """

    def delete(self, key: str) -> bool:
        """Delete a key.

        Args:
            key: The key to delete.

        Returns:
            True if the key was deleted, False otherwise.
        """
"""
