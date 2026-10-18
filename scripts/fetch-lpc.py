#!/usr/bin/env python3
"""Fetch the bounded pinned visual-fixture selection, never overwrite mismatches."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from urllib.parse import quote
from urllib.request import urlopen

PROJECT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=PROJECT / 'fixtures/lpc')
args = parser.parse_args()
manifest = json.loads((PROJECT / 'scripts/lpc-fixtures.json').read_text())
root = args.root
for directory in ['originals', 'icons', 'provenance']:
    (root / directory).mkdir(parents=True, exist_ok=True)

def obtain(path, url, digest):
    data = path.read_bytes() if path.exists() else urlopen(url, timeout=45).read()
    assert hashlib.sha256(data).hexdigest() == digest, f'Pinned hash mismatch: {path}'
    if not path.exists():
        path.write_bytes(data)
    return data

for item in manifest['items']:
    url = f"https://raw.githubusercontent.com/justgook/LPC-rework/{manifest['revision']}/" + quote(item['source_path'])
    data = obtain(root / 'originals' / (item['id'] + '.png'), url, item['sha256'])
    assert struct.unpack('>II', data[16:24]) == (192, 256), item['id']
for record in manifest['provenance']:
    obtain(root / 'provenance' / record['filename'], record['url'], record['sha256'])
(root / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
(root / 'README.md').write_text((PROJECT / 'scripts/lpc-fixtures.md').read_text())
print(f"Verified {len(manifest['items'])} pinned LPC originals and {len(manifest['provenance'])} provenance files")
