#!/usr/bin/env python3
"""Bundle local LPC originals/icons and source palettes into a disposable mock."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct

PROJECT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=PROJECT / 'fixtures/lpc')
args = parser.parse_args()
root = args.root
sources = json.loads((root / 'sources.json').read_text())
ramps = json.loads((root / 'provenance/ramps.json').read_text())
categories = {item['ramp_category'] for item in sources['items']}
palettes = {category: {name: [[round(pixel[channel] * 255) for channel in ('r', 'g', 'b', 'a')]
             for pixel in ramp] for name, ramp in ramps[category].items()} for category in sorted(categories)}
items = []
for source in sources['items']:
    sheet = (root / 'originals' / (source['id'] + '.png')).read_bytes()
    icon = (root / 'icons' / (source['id'] + '.png')).read_bytes()
    assert hashlib.sha256(sheet).hexdigest() == source['sha256'], source['id']
    assert struct.unpack('>II', icon[16:24]) == (32, 32), source['id']
    items.append({**source, 'sheet_base64': base64.b64encode(sheet).decode(),
                  'icon_base64': base64.b64encode(icon).decode()})
catalog = {'revision': sources['revision'], 'frame_size': 64, 'idle_frames': 3,
           'direction_rows': {'north': 0, 'west': 1, 'south': 2, 'east': 3},
           'items': items, 'palettes': palettes}
(root / 'mock-catalog.json').write_text(json.dumps(catalog, indent=2) + '\n')
print(f'Bundled {len(items)} LPC layers across {len({item["slot"] for item in items})} slots')
