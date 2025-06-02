from __future__ import annotations

import argparse
import sys

from cloudkv import SyncCloudKV, __version__, _shared


def cli() -> int:
    parser = argparse.ArgumentParser(
        prog='cloudkv',
        description=f"""\
CloudKV v{__version__}\n\n

CLI for creating CloudKV namespces.

See https://github.com/samuelcolvin/cloudkv for more details.
""",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        '-u',
        '--base-url',
        nargs='?',
        help=f'CloudKV Base URL, defaults to {_shared.DEFAULT_BASE_URL}.',
        default=_shared.DEFAULT_BASE_URL,
    )
    parser.add_argument('--version', action='store_true', help='Show version and exit')
    args = parser.parse_args()
    if args.version:
        print(__version__)
        return 0

    print('creating namespace...')
    ns = SyncCloudKV.create_namespace(base_url=args.base_url)

    print(f"""\
Namespace created successfully.

cloudkv_read_key = {ns.read_key!r}
cloudkv_write_key = {ns.write_key!r}\
""")
    if args.base_url != _shared.DEFAULT_BASE_URL:
        print(f'cloudkv_base_url = {args.base_url!r}')
    return 0


def cli_exit():
    sys.exit(cli())


if __name__ == '__main__':
    cli()
