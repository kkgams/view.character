"""Restore pinned research assets without overwriting customized files.

Downloads are research-only, not imports into runtime/production. Existing bytes
must match the catalog. Archive members are copied by exact name, never extracted
by an untrusted archive-supplied filesystem path. License evidence is retained.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def fetch(root=ROOT):
    root = Path(root).resolve()
    catalog = json.loads((root / 'assets/lpc/animations.json').read_text())
    pending = list(catalog['assets'])
    cache = {}
    while pending:
        progress = False
        for record in pending[:]:
            target = (root / record['path']).resolve()
            if not target.is_relative_to(root / 'assets/lpc'):
                raise ValueError(f'Unsafe research asset path: {target}')
            digest = record['sha256']
            if target.exists():
                data = target.read_bytes()
            elif digest in cache:
                data = cache[digest]
            elif record.get('archive_member'):
                if record.get('archive_path'):
                    archive = root / record['archive_path']
                    if not archive.is_file():
                        continue
                    packed = archive.read_bytes()
                else:
                    archive_hash = record['archive_sha256']
                    if archive_hash not in cache:
                        with urllib.request.urlopen(record['url'], timeout=60) as response:
                            cache[archive_hash] = response.read()
                    packed = cache[archive_hash]
                    if hashlib.sha256(packed).hexdigest() != archive_hash:
                        raise ValueError('Archive hash mismatch')
                if zipfile.is_zipfile(io.BytesIO(packed)):
                    with zipfile.ZipFile(io.BytesIO(packed)) as bundle:
                        data = bundle.read(record['archive_member'])
                else:
                    # 7z needs seekable input; libarchive cannot read this pack from a pipe.
                    # Only the named member's stdout is extracted, never archive paths to disk.
                    with tempfile.NamedTemporaryFile(suffix='.7z') as archive_file:
                        archive_file.write(packed)
                        archive_file.flush()
                        data = subprocess.run(['tar', '-xOf', archive_file.name, record['archive_member']],
                                              stdout=subprocess.PIPE, check=True).stdout
            else:
                request = urllib.request.Request(record['url'], headers={'User-Agent': 'view.character LPC research catalog'})
                with urllib.request.urlopen(request, timeout=60) as response:
                    data = response.read()
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError(f'Pinned hash mismatch (not overwritten): {target}')
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                # Exclusive creation also protects files created while fetching.
                with target.open('xb') as output:
                    output.write(data)
            cache[digest] = data
            pending.remove(record)
            progress = True
            print(f"verified {record['path']}")
        if not progress:
            raise ValueError('Unresolved archive dependencies in research catalog')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    fetch()
