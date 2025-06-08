from __future__ import annotations

from typing import Any

import pydantic
import pytest
from inline_snapshot import snapshot

from cloudkv import _utils as utils


@pytest.mark.parametrize(
    'value,expected_data,expected_content_type',
    [
        ('test', snapshot(b'test'), snapshot('text/plain')),
        (b'test', snapshot(b'test'), snapshot(None)),
        (bytearray(b'test'), snapshot(b'test'), snapshot(None)),
        ([1, 2, 3], snapshot(b'[1,2,3]'), snapshot('application/json; pydantic')),
        ({'a': 1, 'b': 2}, snapshot(b'{"a":1,"b":2}'), snapshot('application/json; pydantic')),
        ({'a': 1, 'b': 2}, snapshot(b'{"a":1,"b":2}'), snapshot('application/json; pydantic')),
    ],
)
def test_encode(value: Any, expected_data: bytes, expected_content_type: str):
    data, content_type = utils.encode_value(value)
    assert data == expected_data
    assert content_type == expected_content_type


def decode_value_kwargs(
    data: bytes | None,
    content_type: str | None,
    return_type: type[Any],
    default: Any = None,
    force_validate: bool = False,
) -> dict[str, Any]:
    return {
        'data': data,
        'content_type': content_type,
        'return_type': return_type,
        'default': default,
        'force_validate': force_validate,
    }


class Model(pydantic.BaseModel):
    x: int
    y: list[dict[str, tuple[set[bytes], float]]]


@pytest.mark.parametrize(
    'kwargs,expected',
    [
        (decode_value_kwargs(None, None, int), snapshot(None)),
        (decode_value_kwargs(b'hello', None, str), snapshot('hello')),
        (decode_value_kwargs(b'hello', None, bytes), snapshot(b'hello')),
        (decode_value_kwargs(b'hello', None, bytearray), snapshot(bytearray(b'hello'))),
        (decode_value_kwargs(b'123', 'application/json; pydantic', int), snapshot(123)),
        (
            decode_value_kwargs(b'{"x":1,"y":[{"a":[["b","c"],1.0]}]}', 'application/json; pydantic', dict[str, Any]),
            snapshot({'x': 1, 'y': [{'a': [['b', 'c'], 1.0]}]}),
        ),
        (
            decode_value_kwargs(b'{"x":1,"y":[{"a":[["b","c"],1.0]}]}', 'application/json; pydantic', Model),
            snapshot(Model(x=1, y=[{'a': ({b'b', b'c'}, 1.0)}])),
        ),
    ],
)
def test_decode_value_kwargs(kwargs: dict[str, Any], expected: Any):
    assert utils.decode_value(**kwargs) == expected


@pytest.mark.parametrize(
    'kwargs',
    [
        (decode_value_kwargs(b'123', None, int)),
        (decode_value_kwargs(b'[1, 2, 3]', None, list[int])),
        (decode_value_kwargs(b'123', None, Model)),
    ],
)
def test_decode_value_kwargs_error(kwargs: dict[str, Any]):
    with pytest.raises(RuntimeError, match='Content-Type was not'):
        utils.decode_value(**kwargs)


@pytest.mark.parametrize(
    'kwargs,params',
    [
        ({}, snapshot({})),
        ({'like': 'test'}, snapshot({'like': 'test'})),
        ({'offset': 10}, snapshot({'offset': '10'})),
        ({'starts_with': 'test'}, snapshot({'like': 'test%'})),
        ({'starts_with': 'te%st'}, snapshot({'like': 'te\\%st%'})),
        ({'ends_with': 'test'}, snapshot({'like': '%test'})),
        ({'contains': 'test'}, snapshot({'like': '%test%'})),
    ],
)
def test_tokens_query_params(kwargs: dict[str, Any], params: dict[str, str]):
    kwargs.setdefault('starts_with', None)
    kwargs.setdefault('ends_with', None)
    kwargs.setdefault('contains', None)
    kwargs.setdefault('like', None)
    kwargs.setdefault('offset', None)
    assert utils.keys_query_params(**kwargs) == params
