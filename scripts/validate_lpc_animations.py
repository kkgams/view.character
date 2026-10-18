"""Validate the independent research catalog, provenance and extractable grid coordinates.

No runtime registry/database is read or modified. Paths are workspace-relative.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'assets/lpc/animations.json'


def png_dimensions(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Not a PNG')
    offset, dimensions, ended = 8, None, False
    while offset < len(data):
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        chunk = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        checksum = data[offset + 8 + length:offset + 12 + length]
        if len(payload) != length or len(checksum) != 4:
            raise ValueError('Truncated PNG')
        if zlib.crc32(chunk + payload) != struct.unpack('>I', checksum)[0]:
            raise ValueError('Invalid PNG checksum')
        if chunk == b'IHDR':
            dimensions = struct.unpack('>II', payload[:8])
        if chunk == b'IEND':
            ended = True
            break
        offset += length + 12
    if dimensions is None or not ended or min(dimensions) <= 0:
        raise ValueError('Incomplete PNG')
    return dimensions


def validate(catalog_path=CATALOG, root=ROOT):
    root = Path(root).resolve()
    catalog = json.loads(Path(catalog_path).read_text())
    if catalog['format'] != 'lpc-animation-catalog' or catalog['version'] != 1:
        raise ValueError('Unsupported catalog format')
    sources = {entry['id']: entry for entry in catalog['sources']}
    layouts = {entry['id']: entry for entry in catalog['layouts']}
    if len(sources) != len(catalog['sources']) or len(layouts) != len(catalog['layouts']):
        raise ValueError('Duplicate source/layout ID')
    assets = {}
    for asset in catalog['assets']:
        path = (root / asset['path']).resolve()
        if not path.is_relative_to(root / 'assets/lpc'):
            raise ValueError(f'Asset escapes research directory: {path}')
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != asset['sha256']:
            raise ValueError(f'Hash mismatch: {path}')
        if not asset['url'] or asset['source'] not in sources:
            raise ValueError(f'Missing provenance: {path}')
        if not asset['license'] or not asset['authors'] or not asset['license_evidence']:
            raise ValueError(f'Missing license/attribution evidence: {path}')
        if asset.get('dimensions') is not None:
            if png_dimensions(data) != tuple(asset['dimensions']):
                raise ValueError(f'Dimension mismatch: {path}')
        if asset['path'] in assets:
            raise ValueError(f'Duplicate asset record: {path}')
        assets[asset['path']] = asset
    body_strips = {a['source_name']: a for a in catalog['animations']
                   if a['layout_id'] == 'universal-split' and a['verified']}
    cardinal = dict(zip('nwse', ['north', 'west', 'south', 'east']))
    ids, orders, counts = set(), {}, {'original': set(), 'extended': set(), 'community': set()}
    for animation in catalog['animations']:
        if animation['id'] in ids:
            raise ValueError(f"Duplicate animation ID: {animation['id']}")
        ids.add(animation['id'])
        if animation['category'] not in counts or animation['source'] not in sources:
            raise ValueError(f"Unknown category/source: {animation['id']}")
        if 'body_pose_references' in animation:
            references = animation['body_pose_references']
            if len(references) != len(animation['directions']):
                raise ValueError(f"Custom body reference row mismatch: {animation['id']}")
            for direction, row in zip(animation['directions'], references):
                if len(row) != animation['frame_counts'][direction]:
                    raise ValueError(f"Custom body reference count mismatch: {animation['id']}")
                for reference in row:
                    match = re.fullmatch(r'([a-z0-9_]+)-([nwse]),([0-9]+)', reference)
                    if match is None or match[1] not in body_strips:
                        raise ValueError(f'Custom body reference is unknown: {reference}')
                    source = body_strips[match[1]]
                    facing = cardinal[match[2]]
                    if facing not in source['directions'] or int(match[3]) not in source['physical_frames'][facing]:
                        raise ValueError(f'Custom body reference is out of bounds: {reference}')
        if not animation['verified']:
            continue
        if not animation['evidence'] or not animation['category_evidence']:
            raise ValueError(f"Missing verification evidence: {animation['id']}")
        layout = layouts[animation['layout_id']]
        if animation['order'] is not None:
            key = (animation['layout_id'], animation['order'])
            if key in orders:
                raise ValueError(f'Duplicate source order: {key}')
            orders[key] = animation['id']
        fw, fh = animation['frame_width'], animation['frame_height']
        if type(fw) is not int or type(fh) is not int or min(fw, fh) <= 0:
            raise ValueError(f"Invalid frame geometry: {animation['id']}")
        if not animation['asset_paths']:
            raise ValueError(f"Verified animation has no sheet: {animation['id']}")
        for direction in animation['directions']:
            count = animation['frame_counts'][direction]
            row = animation['row_ranges'][direction]
            columns = animation['column_ranges'][direction]
            physical = animation['physical_frames'][direction]
            if type(count) is not int or count <= 0 or len(physical) != count:
                raise ValueError(f"Frame count mismatch: {animation['id']}/{direction}")
            if row[0] != row[1] or columns[0] < 0 or row[0] < 0:
                raise ValueError('Only explicit single-grid-row directions are supported')
            for column in physical:
                if type(column) is not int or not columns[0] <= column <= columns[1]:
                    raise ValueError(f'Physical column out of range: {column}')
            sequence = animation['playback_order'][direction]
            if sequence is not None and any(frame not in physical for frame in sequence):
                raise ValueError(f"Playback references absent pose: {animation['id']}")
            for asset_path in animation['asset_paths']:
                asset = assets[asset_path]
                width, height = asset['dimensions']
                if (columns[1] + 1) * fw > width or (row[1] + 1) * fh > height:
                    raise ValueError(f"Frame bounds exceed sheet: {animation['id']}/{direction}")
                padding = asset.get('trailing_padding_px', {})
                if (width - padding.get('right', 0)) % fw or (height - padding.get('bottom', 0)) % fh:
                    raise ValueError(f"Sheet not aligned to layout grid: {asset_path}")
                if layout['kind'] in ('separate strips', 'separate strip') and width // fw != count:
                    raise ValueError(f"Physical strip width/count mismatch: {animation['id']}")
                occupied = asset.get('alpha_occupied_columns_by_row')
                if occupied is not None and not set(physical).issubset(occupied[row[0]]):
                    raise ValueError(f"Recorded source alpha bounds disagree: {animation['id']}")
        for profile in animation.get('timing_profiles', []):
            for physical in animation['physical_frames'].values():
                if any(type(frame) is not int or frame not in physical for frame in profile['sequence']):
                    raise ValueError(f"Guide references absent pose: {animation['id']}")
            if len(profile['sequence']) != len(profile['holds_ticks']) or profile['tick_fps'] <= 0:
                raise ValueError(f"Invalid guide timing: {animation['id']}")
            if profile['asset_path'] not in assets or any(hold <= 0 for hold in profile['holds_ticks']):
                raise ValueError(f"Missing guide/invalid holds: {animation['id']}")
        if layout['coordinate_basis'] != 'zero-based inclusive grid cells':
            raise ValueError('Unsupported coordinate basis')
        counts[animation['category']].add(animation['canonical_id'])
    # JSON array order must retain the explicitly recorded source order, not name order.
    for layout in layouts:
        sequence = [a['order'] for a in catalog['animations'] if a['layout_id'] == layout and a['order'] is not None]
        if sequence != sorted(sequence):
            raise ValueError(f'Catalog reordered source definitions: {layout}')
    return {'verified_canonical_animations': {key: len(value) for key, value in counts.items()},
            'verified_variants': sum(a['verified'] for a in catalog['animations']),
            'unverified_candidates': sum(not a['verified'] for a in catalog['animations']),
            'assets': len(assets), 'layouts': len(layouts)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=CATALOG)
    args = parser.parse_args()
    print(json.dumps(validate(args.catalog), indent=2))
