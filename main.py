from devtools import debug

from cloudkv import AsyncCloudKV


async def main():
    # r = await AsyncCloudKV.create_namespace()
    # print(r)
    async with AsyncCloudKV('eaCgfqhXx1Nb52ZfwN7bQeVMUvyJCghlpBOraHlk4fYbKMff') as kv:
        await kv.set('foobar', 'value')
        value = await kv.get('foobar')
        print(value)
        debug(await kv.keys())


if __name__ == '__main__':
    import asyncio

    asyncio.run(main())
