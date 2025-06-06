# cloudkv

[![CI](https://github.com/samuelcolvin/cloudkv/actions/workflows/ci.yml/badge.svg)](https://github.com/samuelcolvin/cloudkv/actions?query=event%3Apush+branch%3Amain+workflow%3ACI)
[![pypi](https://img.shields.io/pypi/v/cloudkv.svg)](https://pypi.python.org/pypi/cloudkv)
[![versions](https://img.shields.io/pypi/pyversions/cloudkv.svg)](https://github.com/samuelcolvin/cloudkv)
[![license](https://img.shields.io/github/license/samuelcolvin/cloudkv.svg)](https://github.com/samuelcolvin/cloudkv/blob/main/LICENSE)

key/value store based on Cloudflare workers.

Some reasons you might use

## Installation

```bash
uv add cloudkv
```

(or `pip install cloudkv` if you're old school)

## Usage

cloudkv stores key-value pairs in a Cloudflare worker using KV storage and D1.

By default the `cloudkv` package connects to `https://cloudkv.samuelcolvin.workers.dev` but you can deploy an instance to your own worker if you prefer.

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
