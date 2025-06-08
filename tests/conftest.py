import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable

import httpx
import pytest

if TYPE_CHECKING:

    def IsDatetime(*args: Any, **kwargs: Any) -> datetime: ...
    def IsFloat(*args: Any, **kwargs: Any) -> float: ...
    def IsInt(*args: Any, **kwargs: Any) -> int: ...
    def IsNow(*args: Any, **kwargs: Any) -> datetime: ...
    def IsStr(*args: Any, **kwargs: Any) -> str: ...
else:
    from dirty_equals import IsDatetime, IsFloat, IsInt, IsNow as _IsNow, IsStr

    def IsNow(*args: Any, **kwargs: Any):
        kwargs.setdefault('delta', 10)
        kwargs.setdefault('tz', timezone.utc)
        return _IsNow(*args, **kwargs)


@pytest.fixture(scope='session')
def anyio_backend():
    return 'asyncio'


@pytest.fixture(scope='session')
def server() -> Iterable[str]:
    """Run the dev cf worker."""

    base_url = 'http://localhost:8787'
    cf_dir = Path(__file__).parent.parent / 'cf-worker'
    schema_sql = (cf_dir / 'schema.sql').read_text()
    schema_sql += '\ndelete from namespaces;'

    with tempfile.NamedTemporaryFile() as f:
        f.write(schema_sql.encode())
        f.flush()
        # reset the local database for testing
        p = subprocess.run(
            ['npx', 'wrangler', 'd1', 'execute', 'cloudkv-limits', '--local', '--file', f.name],
            cwd=cf_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        if p.returncode != 0:  # pragma: no cover
            raise RuntimeError(f'SQL reset command failed with exit code {p.returncode}:\n{p.stdout.decode()}')

    server_process = subprocess.Popen(
        ['npm', 'run', 'dev'],
        cwd=cf_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        _check_connection(base_url)

        yield base_url

    finally:
        # Stop the development server
        server_process.terminate()


def _check_connection(base_url: str):  # pragma: no cover
    with httpx.Client(timeout=1) as client:
        for _ in range(10):
            try:
                r = client.get(base_url)
            except httpx.HTTPError:
                time.sleep(0.1)
            else:
                if r.status_code == 200:
                    break

        r = client.get(base_url)
        r.raise_for_status()
