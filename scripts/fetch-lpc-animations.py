#!/usr/bin/env python3
"""Fetch pinned default body/head animation sheets; never replace mismatched files."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from urllib.parse import quote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def obtain(path, url, digest):
    data = path.read_bytes() if path.exists() else urlopen(url, timeout=45).read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f'Pinned hash mismatch: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(data)
    return data


def fetch(root):
    manifest = json.loads((ROOT / 'scripts/lpc-animations.json').read_text())
    for animation in manifest['animations']:
        for role, layer in manifest['layers'].items():
            source = animation[role]
            url = f"https://raw.githubusercontent.com/{manifest['repository']}/{manifest['revision']}/" + quote(source['source_path'])
            path = root / 'originals' / role / f"{animation['id']}_{layer}.png"
            data = obtain(path, url, source['sha256'])
            expected = (animation['frames'] * manifest['frame_size'], len(animation['directions']) * manifest['frame_size'])
            if data[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', data[16:24]) != expected:
                raise ValueError(f'Unexpected sheet geometry: {path}')
    for source in manifest['provenance']:
        obtain(root / 'provenance' / source['filename'], source['url'], source['sha256'])
    print(f"Verified {len(manifest['animations'])} body/head animation pairs in {root}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT / 'fixtures/lpc-animations')
    fetch(parser.parse_args().root)
