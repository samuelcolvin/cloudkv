from __future__ import annotations as _annotations

from datetime import datetime

import httpx
import pydantic

DEFAULT_BASE_URL = 'https://cloudkv.samuelcolvin.workers.dev'


def keys_query_params(
    starts_with: str | None, ends_with: str | None, contains: str | None, like: str | None, offset: int | None
) -> dict[str, str]:
    if starts_with is not None:
        like = _escape_like_pattern(starts_with) + '%'
    elif ends_with is not None:
        like = '%' + _escape_like_pattern(ends_with)
    elif contains is not None:
        like = '%' + _escape_like_pattern(contains) + '%'

    params = {'like': like} if like is not None else {}
    if offset is not None:
        params['offset'] = str(offset)

    return params


def _escape_like_pattern(pattern: str) -> str:
    return pattern.replace('%', '\\%').replace('_', '\\_')


class CreateNamespaceResponse(pydantic.BaseModel):
    read_key: str
    write_key: str
    created_at: datetime


class SetResponse(pydantic.BaseModel):
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
