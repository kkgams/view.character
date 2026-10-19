#!/usr/bin/env python3
"""Restore pinned raw motion sheets and build fixtures/lpc/motion-catalog.json.

No conversion, quantization, upstream setup or invented cells. Pin changes are
explicit manifest edits, never automatic discovery. Existing mismatches fail.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import struct
import tempfile
from urllib.parse import quote
from urllib.request import urlopen

PROJECT = Path(__file__).resolve().parents[1]
DIRECTIONS = ['north', 'west', 'south', 'east']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique(records, label):
    require(isinstance(records, list), f'{label} must be a list')
    ids = [record['id'] for record in records]
    require(len(ids) == len(set(ids)), f'Duplicate {label} id')
    require(all(isinstance(id_, str) and re.fullmatch(r'[a-z0-9_-]+', id_) for id_ in ids), f'Unsafe {label} id')


def validate(manifest, fixtures, motions):
    require(manifest['revision'] == fixtures['revision'] == motions['revision'], 'Revision mismatch')
    require(manifest['repository'] == motions['repository'] == 'justgook/LPC-rework', 'Repository mismatch')
    require(manifest['frame_size'] == motions['frame_size'] == 64, 'Expected 64px cells')
    require(manifest['provenance'] == fixtures['provenance'], 'Provenance records changed')
    for records, label in [(fixtures['items'], 'fixtures'), (manifest['items'], 'items'), (motions['animations'] + motions['pose_sheets'], 'sheets'), (motions['poses'], 'poses')]:
        unique(records, label)
    sources = {item['id']: item for item in fixtures['items']}
    sheets = {sheet['id']: sheet for sheet in motions['animations'] + motions['pose_sheets']}
    require({item['id'] for item in manifest['items']} == set(sources), 'Item selection mismatch')
    for sheet in sheets.values():
        require(type(sheet['frames']) is int and sheet['frames'] > 0, 'Invalid reference frames')
        require(sheet['directions'] == (['north'] if sheet['id'] == 'climb' else DIRECTIONS), 'Invalid reference directions')
    for clip in motions['animations']:
        require(len(clip['preview_sequence']) == len(clip['preview_duration_ms']) > 0, 'Invalid preview timeline')
        require(all(type(n) is int and 0 <= n < clip['frames'] for n in clip['preview_sequence']), 'Invalid preview column')
        require(all(type(n) is int and n > 0 for n in clip['preview_duration_ms']), 'Invalid preview duration')
    for pose in motions['poses']:
        require(pose['sheet'] in {sheet['id'] for sheet in motions['pose_sheets']}, 'Invalid pose sheet')
        sheet = sheets[pose['sheet']]
        require(type(pose['column']) is int and 0 <= pose['column'] < sheet['frames'], 'Invalid pose column')
        require(pose['directions'] == sheet['directions'] and pose['preview_direction'] in pose['directions'], 'Invalid pose directions')
    for item in manifest['items']:
        source = sources[item['id']]
        require({key: value for key, value in item.items() if key != 'sheets'} == source, 'Item metadata/clearance changed')
        require(set(item['sheets']) == set(sheets), 'Incomplete per-item sheet mapping')
        for id_, record in item['sheets'].items():
            sheet = sheets[id_]
            expected = str(PurePosixPath(source['source_path']).with_name(PurePosixPath(sheet['body']['source_path']).name))
            require(record['source_path'] == expected, 'Unexpected sibling source path')
            if record['status'] == 'absent':
                require(record == {'source_path': expected, 'status': 'absent', 'http_status': 404}, 'Invalid absent record')
                continue
            require(record['status'] == 'present', 'Invalid source status')
            require(re.fullmatch(r'[0-9a-f]{64}', record['sha256']) is not None, 'Invalid SHA256')
            require(type(record['frames']) is int and record['frames'] > 0, 'Invalid frame count')
            require(record['width'] == record['frames'] * 64, 'Invalid source width')
            dirs = record['directions']
            require(dirs == sheet['directions'] or id_ == 'climb' and dirs == DIRECTIONS and bool(record.get('source_row_contract')), 'Unexpected source rows')
            require(record['height'] == len(dirs) * 64, 'Invalid source height')
            if record['frames'] != sheet['frames']:
                variance = record['frame_count_variance']
                require(variance['reference_frames'] == sheet['frames'] and variance['actual_frames'] == record['frames'] and bool(variance['note']), 'Unrecorded frame count variance')
            else:
                require('frame_count_variance' not in record, 'Spurious frame count variance')
            if id_ == 'idle':
                require(record['sha256'] == source['sha256'], 'Idle hash differs from existing fixture')
            if item['id'] in ('body', 'head'):
                require(record['sha256'] == sheet[item['id']]['sha256'], 'Default source pin mismatch')


def geometry(data):
    require(len(data) >= 33 and data[:8] == b'\x89PNG\r\n\x1a\n' and data[8:16] == b'\x00\x00\x00\rIHDR', 'Malformed PNG header')
    return struct.unpack('>II', data[16:24])


def download(url):
    # Unexpected HTTP404 and all other network errors propagate.
    with urlopen(url, timeout=45) as response:
        return response.read()


def obtain(path, url, digest, reuse=None, dimensions=None, fetch=download):
    if path.exists():
        data = path.read_bytes()
    elif reuse is not None and reuse.exists():
        data = reuse.read_bytes()
    else:
        data = fetch(url)
    require(hashlib.sha256(data).hexdigest() == digest, f'Pinned hash mismatch: {path}')
    if dimensions is not None:
        require(geometry(data) == dimensions, f'Unexpected source geometry: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with path.open('xb') as output:
            output.write(data)
    return data


def prepare(root, manifest, fixtures, motions, fetch=download):
    validate(manifest, fixtures, motions)
    catalog = {
        'frame_size': 64,
        'animations': [{key: clip[key] for key in ('id', 'frames', 'directions', 'preview_sequence', 'preview_duration_ms', 'preview_timing')} for clip in motions['animations']],
        'pose_sheets': [{key: sheet[key] for key in ('id', 'frames', 'directions')} for sheet in motions['pose_sheets']],
        'poses': motions['poses'],
        'items': [],
    }
    present = absent = 0
    for item in manifest['items']:
        output = {'id': item['id'], 'sheets': {}}
        for id_, record in item['sheets'].items():
            path = root / 'motions' / item['id'] / f"{id_}_{item['layer']}.png"
            if record['status'] == 'absent':
                require(not path.exists(), f'Unpinned file for absent source: {path}')
                print(f"Absent (pinned HTTP 404): {item['id']}/{id_}: {record['source_path']}")
                absent += 1
                continue
            url = f"https://raw.githubusercontent.com/{manifest['repository']}/{manifest['revision']}/" + quote(record['source_path'])
            reuse = root / 'originals' / f"{item['id']}.png" if id_ == 'idle' else None
            data = obtain(path, url, record['sha256'], reuse, (record['width'], record['height']), fetch)
            output['sheets'][id_] = {'sheet_base64': base64.b64encode(data).decode('ascii'), 'frames': record['frames'], 'directions': record['directions']}
            present += 1
        catalog['items'].append(output)
    for record in manifest['provenance']:
        obtain(root / 'provenance' / record['filename'], record['url'], record['sha256'], fetch=fetch)
    with tempfile.NamedTemporaryFile(mode='w', dir=root, prefix='.motion-catalog-', delete=False) as output:
        temp = Path(output.name)
        try:
            json.dump(catalog, output, separators=(',', ':'))
            output.write('\n')
            output.close()
            temp.replace(root / 'motion-catalog.json')
        finally:
            temp.unlink(missing_ok=True)
    print(f'Verified {present} raw sheets; {absent} explicitly absent; {len(catalog["items"])} items, {len(catalog["animations"])} clips, {len(catalog["pose_sheets"])} pose sheets, {len(catalog["poses"])} poses')
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=PROJECT / 'fixtures/lpc')
    args = parser.parse_args()
    manifests = [json.loads((PROJECT / 'scripts' / name).read_text()) for name in ('lpc-motion-fixtures.json', 'lpc-fixtures.json', 'lpc-animations.json')]
    prepare(args.root, *manifests)


if __name__ == '__main__':
    main()
