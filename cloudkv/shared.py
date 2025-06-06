from __future__ import annotations as _annotations

import os
from datetime import datetime

import httpx
import pydantic

__all__ = (
    'DEFAULT_BASE_URL',
    'PYDANTIC_CONTENT_TYPE',
    'CreateNamespaceDetails',
    'SetDetails',
    'Key',
    'KeysResponse',
    'ResponseError',
)
DEFAULT_BASE_URL = os.getenv('CLOUDKV_BASE_URL', 'https://cloudkv.samuelcolvin.workers.dev')
PYDANTIC_CONTENT_TYPE = 'application/json; pydantic'


class CreateNamespaceDetails(pydantic.BaseModel):
    read_key: str
    write_key: str
    created_at: datetime


class SetDetails(pydantic.BaseModel):
    url: str
    key: str
    content_type: str
    size: int
    created_at: str
    expiration: str


class Key(pydantic.BaseModel):
    url: str
    key: str
    content_type: str | None
    size: int
    created_at: datetime
    expiration: datetime


class KeysResponse(pydantic.BaseModel):
    keys: list[Key]


class ResponseError(ValueError):
    @classmethod
    def check(cls, response: httpx.Response) -> None:
        if not response.is_success:
            raise cls(f'Unexpected {response.status_code} response: {response.text}')
