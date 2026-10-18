"""Prepare pinned, ignored development checkouts; never pull/reset existing work."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'scripts/fixture-repositories.json'


def git(*arguments):
    return subprocess.run(['git', *map(str, arguments)], check=True,
                          stdout=subprocess.PIPE, text=True).stdout.strip()


def check_checkout(path, record):
    if not (path / '.git').is_dir():
        raise ValueError(f'Not a fixture Git checkout: {path}')
    actual_url = git('-C', path, 'remote', 'get-url', 'origin')
    if actual_url.removesuffix('.git').casefold() != record['url'].removesuffix('.git').casefold():
        raise ValueError(f'Unexpected origin at {path}: {actual_url}')
    actual_revision = git('-C', path, 'rev-parse', 'HEAD')
    if actual_revision != record['revision']:
        raise ValueError(f'Wrong revision at {path}: {actual_revision}; expected {record["revision"]}. '
                         'Existing work was not changed; inspect it before deliberately repinning.')
    if git('-C', path, 'status', '--porcelain'):
        raise ValueError(f'Modified fixture checkout: {path}; preserve your work before preparing fixtures')


def prepare(record, *, root=ROOT, check_only=False):
    if record['mode'] != 'clone':
        raise ValueError('Only clone records belong to this preparer')
    if not re.fullmatch(r'[0-9a-f]{40}', record['revision']):
        raise ValueError('Repository fixture requires an exact commit SHA')
    root = Path(root).resolve()
    destination = (root / record['directory']).resolve()
    if not destination.is_relative_to(root / 'fixtures/repos') or destination == root / 'fixtures/repos':
        raise ValueError(f'Checkout must stay below fixtures/repos: {destination}')
    if destination.exists():
        check_checkout(destination, record)
    elif check_only:
        raise ValueError(f'Missing {destination}; run make fixture-repos for development')
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.fixture-clone-', dir=destination.parent) as directory:
            staged = Path(directory) / 'checkout'
            git('clone', '--depth', '1', '--no-checkout', record['url'], staged)
            if git('-C', staged, 'rev-parse', 'HEAD') != record['revision']:
                git('-C', staged, 'fetch', '--depth', '1', 'origin', record['revision'])
            git('-C', staged, 'checkout', '--detach', record['revision'])
            check_checkout(staged, record)
            # Do not merge with or overwrite a checkout created concurrently.
            if destination.exists():
                raise ValueError(f'Checkout appeared while cloning; not overwritten: {destination}')
            staged.rename(destination)
    print(f"verified {record['id']} @ {record['revision']} → {destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Offline verification only; no download/update')
    parser.add_argument('--id', help='Prepare one registered clone instead of all clone records')
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    records = manifest['repositories']
    if len({record['id'] for record in records}) != len(records):
        raise ValueError('Duplicate fixture repository IDs')
    selected = [record for record in records if record['mode'] == 'clone' and
                (args.id is None or record['id'] == args.id)]
    if not selected:
        raise ValueError(f'No registered clone fixture for {args.id!r}')
    for record in selected:
        prepare(record, check_only=args.check)


if __name__ == '__main__':
    main()
