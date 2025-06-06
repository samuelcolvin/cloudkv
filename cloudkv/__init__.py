from importlib.metadata import version as _metadata_version

from .async_client import AsyncCloudKV
from .sync_client import SyncCloudKV

__all__ = '__version__', 'SyncCloudKV', 'AsyncCloudKV'
__version__ = _metadata_version('cloudkv')
