from cloudkv import SyncCloudKV


def test_init():
    kv = SyncCloudKV('read', 'write')
    assert kv.namespace_read_api_key == 'read'
    assert kv.namespace_write_api_key == 'write'
