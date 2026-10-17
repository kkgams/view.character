#!/usr/bin/env python3
"""Offline fixture integrity and empty-slot Game Icons catalogue checks."""
import argparse
import ast
import base64
import hashlib
import json
from pathlib import Path
import re
import struct

PROJECT = Path(__file__).resolve().parent.parent
ROOT = PROJECT / 'fixtures/lpc'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', type=Path, default=PROJECT.parent / 'gams')
args = parser.parse_args()
for script in (PROJECT / 'tools').glob('*.py'):
    ast.parse(script.read_text())
catalog = json.loads((ROOT / 'mock-catalog.json').read_text())
sources = json.loads((ROOT / 'sources.json').read_text())
assert catalog['revision'] == sources['revision'] == '3d14b9715136dede36de55907b1b2d720a8ff306'
assert catalog['frame_size'] == 64 and catalog['idle_frames'] == 3
assert catalog['direction_rows'] == {'north': 0, 'west': 1, 'south': 2, 'east': 3}
assert len(catalog['items']) == len(sources['items']) == 12
assert len({item['id'] for item in catalog['items']}) == 12
slots = {'body', 'head', 'hair', 'torso', 'legs', 'feet'}
assert {item['slot'] for item in catalog['items']} == slots
for item in catalog['items']:
    sheet = (ROOT / 'originals' / (item['id'] + '.png')).read_bytes()
    icon = (ROOT / 'icons' / (item['id'] + '.png')).read_bytes()
    assert hashlib.sha256(sheet).hexdigest() == item['sha256'], item['id']
    assert base64.b64decode(item['sheet_base64'], validate=True) == sheet, item['id']
    assert base64.b64decode(item['icon_base64'], validate=True) == icon, item['id']
    assert struct.unpack('>II', sheet[16:24]) == (192, 256), item['id']
    assert struct.unpack('>II', icon[16:24]) == (32, 32), item['id']
    assert item['source_ramp'] in catalog['palettes'][item['ramp_category']], item['id']
    assert item['license'] == 'OGA-BY-3.0'
for category in catalog['palettes'].values():
    for ramp in category.values():
        assert len(ramp) == 6
        assert all(len(rgba) == 4 and all(isinstance(c, int) and 0 <= c <= 255 for c in rgba) for rgba in ramp)
for filename in ['credits-characters.txt', 'credits-hair.txt', 'credits-clothing.txt', 'upstream-README.md', 'OGA-BY-3.0.txt']:
    assert (ROOT / 'provenance' / filename).stat().st_size > 0
host = args.host.resolve() / 'cmd/app/src'
registry = {item['ligature']: item for item in json.loads((host / 'fonts/game-icons.json').read_text())['icons']}
assert (host / 'fonts/game-icons.woff2').read_bytes()[:4] == b'wOF2'
source = (PROJECT / 'index.js').read_text()
block = re.search(r'const SLOTS = \[(.*?)\n\]', source, re.S)
assert block, 'Missing explicit slot icon definitions'
bindings = re.findall(r'\["([^"]+)", "[^"]+", "([^"]+)"\]', block.group(1))
assert len(bindings) == 6 and {slot for slot, _ in bindings} == slots
for slot, name in bindings:
    assert name in registry, f'Unknown Game Icons ligature for {slot}: {name}'
print('LPC fixtures OK: 12 source hashes, 12 icons, bundle bytes, palettes and provenance')
print('Game Icons OK: all 6 empty-slot ligatures exist in the canonical Host catalogue')
