from __future__ import annotations as _annotations

import os
from datetime import datetime

import httpx
import pydantic

__all__ = (
    'DEFAULT_BASE_URL',
    'PYDANTIC_CONTENT_TYPE',
    'CreateNamespaceDetails',
    'KeyInfo',
    'KeysResponse',
    'ResponseError',
)
DEFAULT_BASE_URL = os.getenv('CLOUDKV_BASE_URL', 'https://cloudkv.samuelcolvin.workers.dev')
PYDANTIC_CONTENT_TYPE = 'application/json; pydantic'


class CreateNamespaceDetails(pydantic.BaseModel):
    read_key: str
    """Read API key for the namespace"""
    write_key: str
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


class KeysResponse(pydantic.BaseModel):
    keys: list[KeyInfo]


class ResponseError(ValueError):
    @classmethod
    def check(cls, response: httpx.Response) -> None:
        if not response.is_success:
            raise cls(f'Unexpected {response.status_code} response: {response.text}')
