from cloudkv import SyncCloudKV


def test_init():
    kv = SyncCloudKV('read', 'write')
    assert kv.namespace_read_key == 'read'
    assert kv.namespace_write_key == 'write'
