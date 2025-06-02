from devtools import debug

from cloudkv import AsyncCloudKV


async def main():
    # r = await AsyncCloudKV.create_namespace()
    # print(r)
    async with AsyncCloudKV('eaCgfqhXx1Nb52ZfwN7bQeVMUvyJCghlpBOraHlk4fYbKMff') as kv:
        # with debug.timer('set 10 keys'):
        #     for i in range(10):
        #         await kv.set(f'key{i}', f'value{i}')
        # with debug.timer('get 100 keys'):
        #     for i in range(100):
        #         value = await kv.get(f'key{i}')
        # debug(await kv.keys())
        with debug.timer('get found'):
            await kv.get(f'key1')
        with debug.timer('get not found'):
            await kv.get(f'key1234')


if __name__ == '__main__':
    import asyncio

    asyncio.run(main())
