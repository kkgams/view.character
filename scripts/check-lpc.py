#!/usr/bin/env python3
"""Offline fixture integrity, provenance and empty-slot icon catalogue checks."""
import argparse
import ast
import base64
import hashlib
import json
from pathlib import Path
import sqlite3
import struct

PROJECT = Path(__file__).resolve().parent.parent
ROOT = PROJECT / 'fixtures/lpc'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', type=Path, default=PROJECT.parent / 'gams')
args = parser.parse_args()
for script in (PROJECT / 'scripts').glob('*.py'):
    ast.parse(script.read_text())
manifest = json.loads((PROJECT / 'scripts/lpc-fixtures.json').read_text())
catalog = json.loads((ROOT / 'mock-catalog.json').read_text())
sources = json.loads((ROOT / 'sources.json').read_text())
assert sources == manifest, 'Local source manifest differs from pinned fixture selection'
assert catalog['revision'] == manifest['revision'] == '3d14b9715136dede36de55907b1b2d720a8ff306'
assert catalog['frame_size'] == 64 and catalog['idle_frames'] == 3
assert catalog['direction_rows'] == {'north': 0, 'west': 1, 'south': 2, 'east': 3}
assert len(catalog['items']) == len(sources['items'])
assert len({item['id'] for item in catalog['items']}) == len(catalog['items'])
slots = {item['slot'] for item in sources['items']}
assert {item['slot'] for item in catalog['items']} == slots
expected = {item['id']: item for item in manifest['items']}
for item in catalog['items']:
    assert {key: item[key] for key in expected[item['id']]} == expected[item['id']], item['id']
    sheet = (ROOT / 'originals' / (item['id'] + '.png')).read_bytes()
    icon = (ROOT / 'icons' / (item['id'] + '.png')).read_bytes()
    assert hashlib.sha256(sheet).hexdigest() == item['sha256'], item['id']
    assert base64.b64decode(item['sheet_base64'], validate=True) == sheet, item['id']
    assert base64.b64decode(item['icon_base64'], validate=True) == icon, item['id']
    assert struct.unpack('>II', sheet[16:24]) == (192, 256), item['id']
    assert struct.unpack('>II', icon[16:24]) == (32, 32), item['id']
    assert item['source_ramp'] in catalog['palettes'][item['ramp_category']], item['id']
    if item['license'] == 'UNVERIFIED':
        assert item['slot'] == 'beard' and item['provenance_note'], item['id']
    else:
        assert item['license'] == 'OGA-BY-3.0', item['id']
    assert (ROOT / 'provenance' / item['credit_file']).is_file()
ramps = json.loads((ROOT / 'provenance/ramps.json').read_text())
assert set(catalog['palettes']) == {item['ramp_category'] for item in catalog['items']}
for category, values in catalog['palettes'].items():
    expected_ramps = {name: [[round(pixel[channel] * 255) for channel in ('r', 'g', 'b', 'a')]
                      for pixel in ramp] for name, ramp in ramps[category].items()}
    assert values == expected_ramps, category
    for ramp in values.values():
        assert len(ramp) == 6
        assert all(len(rgba) == 4 and all(isinstance(c, int) and 0 <= c <= 255 for c in rgba) for rgba in ramp)
for record in manifest['provenance']:
    assert hashlib.sha256((ROOT / 'provenance' / record['filename']).read_bytes()).hexdigest() == record['sha256'], record['filename']
host = args.host.resolve() / 'cmd/app/src'
registry = {item['ligature']: item for item in json.loads((host / 'fonts/game-icons.json').read_text())['icons']}
assert (host / 'fonts/game-icons.woff2').read_bytes()[:4] == b'wOF2'
connection = sqlite3.connect(':memory:')
connection.executescript((PROJECT / 'development.sql').read_text())
bindings = connection.execute('SELECT id, icon FROM slots ORDER BY "order"').fetchall()
assert bindings, 'Missing SQL slot definitions'
connection.close()
for slot, name in bindings:
    assert name in registry, f'Unknown Game Icons ligature for {slot}: {name}'
print(f'LPC fixtures OK: {len(catalog["items"])} originals/icons, {len(slots)} slots, bundle bytes, palettes and provenance')
print(f'Game Icons OK: all {len(bindings)} empty-slot ligatures exist in the canonical Host catalogue')
print('Facial-hair attribution/license remains UNVERIFIED; local fixtures are not redistribution clearance.')
