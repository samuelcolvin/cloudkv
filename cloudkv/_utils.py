from __future__ import annotations as _annotations

import typing

import pydantic

from .shared import PYDANTIC_CONTENT_TYPE

T = typing.TypeVar('T')
D = typing.TypeVar('D')
ta_lookup: dict[str, pydantic.TypeAdapter[typing.Any]] = {}


def cached_type_adapter(return_type: type[T]) -> pydantic.TypeAdapter[T]:
    key = return_type.__qualname__
    if ta := ta_lookup.get(key):
        return ta
    else:
        ta_lookup[key] = ta = pydantic.TypeAdapter(return_type)
        return ta


def encode_value(value: typing.Any) -> tuple[bytes, str | None]:
    if isinstance(value, str):
        return value.encode('utf-8'), 'text/plain'
    elif isinstance(value, bytes):
        return value, None
    elif isinstance(value, bytearray):
        return bytes(value), None
    else:
        value_type: type[typing.Any] = type(value)
        return cached_type_adapter(value_type).dump_json(value), PYDANTIC_CONTENT_TYPE


def decode_value(
    data: bytes | None, content_type: str | None, return_type: type[T], default: D, force_validate: bool
) -> T | D:
    if data is None:
        return default
    elif force_validate or content_type == PYDANTIC_CONTENT_TYPE:
        return cached_type_adapter(return_type).validate_json(data)
    elif return_type is bytes:
        return typing.cast(T, data)
    elif return_type is str:
        return typing.cast(T, data.decode())
    elif return_type is bytearray:
        return typing.cast(T, bytearray(data))
    else:
        raise RuntimeError(f'Content-Type was not {PYDANTIC_CONTENT_TYPE!r} and return_type was not a string type')


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
