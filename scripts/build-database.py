"""Build a fresh SQLite catalog and optional body/head animation reference docs."""

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
# Importable both as a CLI and through the fixture-free unittest harness.
sys.path.insert(0, str(ROOT / "scripts"))
ANIMATIONS = ROOT / "scripts/lpc-animations.json"


def load_animation_manifest(path=ANIMATIONS):
    manifest = json.loads(Path(path).read_text())
    if manifest['frame_size'] != 64 or manifest['layers'] != {'body': 10, 'head': 100}:
        raise ValueError('Unsupported reference model geometry/layers')
    ids = set()
    pose_sheets = {entry['id']: entry for entry in manifest['pose_sheets']}
    for animation in manifest['animations'] + manifest['pose_sheets']:
        identifier = animation['id']
        if not re.fullmatch(r'[a-z][a-z0-9_]*', identifier) or identifier in ids:
            raise ValueError(f'Invalid/duplicate animation ID: {identifier}')
        ids.add(identifier)
        if not isinstance(animation['name'], str) or not animation['name'].strip():
            raise ValueError(f'Missing animation name: {identifier}')
        if type(animation['frames']) is not int or animation['frames'] <= 0:
            raise ValueError(f'Invalid frame count: {identifier}')
        if animation['directions'] not in [['north'], ['north', 'west', 'south', 'east']]:
            raise ValueError(f'Unsupported source directions: {identifier}')
        if animation['preview_direction'] not in animation['directions']:
            raise ValueError(f'Missing preview direction: {identifier}')
        if identifier in pose_sheets:
            continue
        sequence, durations = animation['preview_sequence'], animation['preview_duration_ms']
        if not sequence or len(sequence) != len(durations):
            raise ValueError(f'Invalid preview sequence: {identifier}')
        if any(type(frame) is not int or not 0 <= frame < animation['frames'] for frame in sequence):
            raise ValueError(f'Preview frame out of range: {identifier}')
        if any(type(duration) is not int or duration <= 0 or duration % 10 for duration in durations):
            raise ValueError(f'GIF duration must be positive centiseconds: {identifier}')
    if not manifest['animations']:
        raise ValueError('Animation reference must not be empty')
    columns = {identifier: [] for identifier in pose_sheets}
    for pose in manifest['poses']:
        identifier = pose['id']
        if not re.fullmatch(r'[a-z][a-z0-9_]*', identifier) or identifier in ids:
            raise ValueError(f'Invalid/duplicate pose ID: {identifier}')
        ids.add(identifier)
        sheet = pose_sheets[pose['sheet']]
        if not isinstance(pose['name'], str) or not pose['name'].strip():
            raise ValueError(f'Missing pose name: {identifier}')
        if type(pose['column']) is not int or not 0 <= pose['column'] < sheet['frames']:
            raise ValueError(f'Pose column out of range: {identifier}')
        if pose['directions'] != sheet['directions'] or pose['preview_direction'] not in pose['directions']:
            raise ValueError(f'Invalid pose directions: {identifier}')
        columns[pose['sheet']].append(pose['column'])
    for identifier, sheet in pose_sheets.items():
        if sorted(columns[identifier]) != list(range(sheet['frames'])):
            raise ValueError(f'Pose sheet must expose each source column once: {identifier}')
    return manifest


def validate_animation_fixtures(manifest, root):
    for animation in manifest['animations'] + manifest['pose_sheets']:
        expected = (animation['frames'] * 64, len(animation['directions']) * 64)
        for role, layer in manifest['layers'].items():
            path = root / 'originals' / role / f"{animation['id']}_{layer}.png"
            if not path.is_file():
                raise ValueError(f'Missing {path}; run make animation-fixtures first')
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != animation[role]['sha256']:
                raise ValueError(f'Pinned hash mismatch: {path}')
            if data[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', data[16:24]) != expected:
                raise ValueError(f'Unexpected sheet geometry: {path}')
    for record in manifest['provenance']:
        path = root / 'provenance' / record['filename']
        if hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
            raise ValueError(f'Pinned provenance mismatch: {path}')


def markdown_text(value):
    return value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('|', '&#124;').replace('\n', ' ')


def animation_markdown(connection, manifest):
    from string import Template

    records = dict(connection.execute('SELECT id, name FROM animations'))
    definitions = {entry['id']: entry for entry in manifest['animations']}
    if records.keys() != definitions.keys():
        raise ValueError('Database animation IDs do not match the prepared reference sheets')
    if any(not isinstance(name, str) or not name.strip() for name in records.values()):
        raise ValueError('Database animation names must be nonempty text')
    rows = []
    for animation in manifest['animations']:
        identifier = animation['id']
        label = markdown_text(records[identifier])
        directions = ', '.join(direction[0].upper() for direction in animation['directions'])
        rows.append(f"| `{identifier}` | {label} | {directions} | {animation['frames']} | ![{label}](content/images/animations/{identifier}.gif) |")
    previews = '\n'.join(['| ID | Name | Directions | Frames | Image |', '| --- | --- | --- | --- | --- |'] + rows)
    pose_rows = []
    for pose in manifest['poses']:
        label = markdown_text(pose['name'])
        directions = ', '.join(direction[0].upper() for direction in pose['directions'])
        pose_rows.append(f"| `{pose['id']}` | {label} | {directions} | 1 | {pose['sheet']} / {pose['column']} | ![{label}](content/images/animations/{pose['id']}.png) |")
    pose_previews = '\n'.join(['| ID | Pose | Directions | Frames | Source / column | Image |', '| --- | --- | --- | --- | --- | --- |'] + pose_rows)
    values = dict(project_previews=previews, pose_previews=pose_previews, pose_count=len(manifest['poses']), animation_count=len(records),
                  repository=manifest['repository'], revision=manifest['revision'],
                  project_credits=f"https://github.com/{manifest['repository']}/blob/{manifest['revision']}/Characters/Credits.txt",
                  illustrative=', '.join(f"`{entry['id']}`" for entry in manifest['animations']
                                         if entry['preview_timing'].startswith('100 ms')))
    return Template((ROOT / 'scripts/project-animations.md').read_text()).substitute(values)


def animation_reference_markdown(manifest):

    from itertools import groupby
    from string import Template

    catalog = json.loads((ROOT / 'assets/lpc/animations.json').read_text())
    sources = {entry['id']: entry for entry in catalog['sources']}

    def entries(layout):
        # JSON preserves source-defined ordering; never alphabetically sort it.
        return [entry for entry in catalog['animations'] if entry['layout_id'] == layout]

    def table(headers, rows):
        return '\n'.join(['| ' + ' | '.join(headers) + ' |',
                          '| ' + ' | '.join('---' for _ in headers) + ' |'] +
                         ['| ' + ' | '.join(str(cell) for cell in row) + ' |' for row in rows])

    def span(bounds):
        start, end = bounds
        return str(start) if start == end else f'{start}–{end}'

    def poses(entry):
        values = set(entry['frame_counts'].values())
        if len(values) != 1:
            raise ValueError(f"Reference table requires uniform per-direction counts: {entry['id']}")
        return next(iter(values))

    def directions(entry):
        return 'NWSE' if entry['directions'] == ['north', 'west', 'south', 'east'] else ', '.join(entry['directions'])

    def sequence(entry):
        value = entry['playback_order'][entry['directions'][0]]
        if value is None:
            return '—'
        if len(value) > 1 and value == list(range(value[0], value[-1] + 1)):
            return span([value[0], value[-1]])
        groups = [(frame, len(list(holds))) for frame, holds in groupby(value)]
        return ', '.join(str(frame) if count == 1 else f'{frame}×{count}' for frame, count in groups)

    original = table(['Source family', 'Poses', 'Local rows', 'Columns', 'Directions'],
                     [(f"`{a['source_name']}`", poses(a), '0' if len(a['directions']) == 1 else '0–3',
                       span(next(iter(a['column_ranges'].values()))), directions(a))
                      for a in entries('original-separate')])
    legacy = table(['Order', 'ID', 'Rows', 'Columns', 'Poses', 'Directions'],
                   [(a['order'], f"`{a['canonical_id']}`",
                     span([min(v[0] for v in a['row_ranges'].values()), max(v[1] for v in a['row_ranges'].values())]),
                     span(next(iter(a['column_ranges'].values()))), poses(a), directions(a))
                    for a in entries('legacy-21-row')])
    universal = table(['Definition order', 'Source preview', 'Stored poses / facing', 'Composite rows', 'Playback columns'],
                      [(a['order'], f"`{a['source_name']}`", f"{poses(a)} / {directions(a)}",
                        span([a['composite_start_row'], a['composite_start_row'] + len(a['directions']) - 1]), sequence(a))
                       for a in entries('universal-preview-local') if a['category'] == 'extended'])
    revised_entries = entries('revised-upstream-separate')
    revised = table(['Source name', 'Poses', 'Directions'],
                    [(markdown_text(a['source_name']), poses(a), directions(a)) for a in revised_entries])
    community = table(['ID', 'Name', 'Stored poses', 'Moving columns'],
                      [(f"`{a['canonical_id']}`", markdown_text(a['name']), poses(a), sequence(a))
                       for a in catalog['animations'] if a['verified'] and a['category'] == 'community'])
    custom = table(['Order', 'Source profile', 'Cell size', 'Columns', 'Item geometry'],
                   [(a['order'], f"`{a['source_name']}`", f"{a['frame_width']}×{a['frame_height']}",
                     poses(a), 'Verified' if a['verified'] else '**Unverified**')
                    for a in entries('universal-custom-definitions')])
    candidates = table(['Candidate', 'Source', 'Geometry'],
                       [(markdown_text(a['name']), f"[Submission]({a['source_url']})", '**Unverified**')
                        for a in catalog['animations'] if a['layout_id'] is None])

    def pinned(source, path):
        record = sources[source]
        return f"{record['url']}/blob/{record['revision']}/{path}"

    project = f"https://github.com/{manifest['repository']}/blob/{manifest['revision']}/"
    values = dict(original_inventory=original, legacy_inventory=legacy,
                  universal_inventory=universal, revised_inventory=revised,
                  community_inventory=community,
                  custom_inventory=custom, candidate_inventory=candidates,
                  original_authors=pinned('style-guide', 'AUTHORS'),
                  legacy_authors=pinned('legacy-unified', 'AUTHORS.txt'),
                  universal_body_credits=pinned('universal', 'sheet_definitions/body/body.json'),
                  universal_weapon_credits=pinned('universal', 'sheet_definitions/weapons/sword/weapon_sword_longsword.json'),
                  revised_credits=pinned('revised', 'Characters/Credits.txt'),
                  project_credits=project + 'Characters/Credits.txt',
                  expanded_url=sources['expanded']['url'], community_url=sources['push-carry']['url'],
                  original_inventory_url=pinned('style-guide', 'source/docs/assets.rst#L9-L34'),
                  original_directions_url=pinned('style-guide', 'source/docs/styleguide.rst#L188-L194'),
                  original_walk_url=pinned('style-guide', 'source/static/demogame/js/actor_model.js#L552-L571'),
                  legacy_sheet_url=pinned('legacy-unified', 'body/male/light.png'),
                  legacy_revision=sources['legacy-unified']['revision'],
                  universal_history_url=pinned('universal', 'README.md#L139-L149'),
                  revised_placement_url=pinned('revised', quote('Characters/_ Guides & Palettes/HeadPlacement.json', safe='/')),
                  jump_original_url=sources['jump-2019']['url'], jump_expanded_url=sources['jump-2021']['url'],
                  universal_constants_url=pinned('universal', 'sources/state/constants.ts#L105-L160'),
                  universal_preview_url=pinned('universal', 'sources/canvas/preview-animation.ts#L182-L199'),
                  revised_guides_url=pinned('revised', quote('Characters/_ Guides & Palettes/Animation Guides', safe='/')).replace('/blob/', '/tree/'),
                  universal_custom_url=pinned('universal', 'sources/custom-animations.ts'),
                  universal_draw_url=pinned('universal', 'sources/canvas/draw-frames.ts#L11-L138'),
                  illustrative=', '.join(f"`{entry['id']}`" for entry in manifest['animations']
                                         if entry['preview_timing'].startswith('100 ms')))
    return Template((ROOT / 'scripts/animation-reference.md').read_text()).substitute(values)


def seed_animations(connection, manifest):
    connection.executemany('INSERT INTO animations (id, name) VALUES (?, ?)',
                           [(entry['id'], entry['name']) for entry in manifest['animations']])
    connection.commit()


def resolve_aseprite(command, *, platform=None):
    requested = str(command)
    executable = shutil.which(requested)
    if executable is not None:
        return executable
    if requested == 'aseprite' and (sys.platform if platform is None else platform) == 'darwin':
        bundled = Path('/Applications/Aseprite.app/Contents/MacOS/aseprite')
        if bundled.is_file() and os.access(bundled, os.X_OK):
            return str(bundled)
    raise ValueError(f'Aseprite CLI not found or executable: {requested}. '
                     'Install Aseprite or run make database ASEPRITE=/absolute/path/to/aseprite')


def stage_animation_docs(connection, manifest, fixtures, stage, aseprite):
    validate_animation_fixtures(manifest, fixtures)
    aseprite = resolve_aseprite(aseprite)
    # Query the built database, not a separate hardcoded documentation name list.
    markdown = animation_markdown(connection, manifest)
    images = stage / 'animation-images'
    images.mkdir()
    render_manifest = stage / 'animation-manifest.json'
    render_manifest.write_text(json.dumps(manifest), encoding='utf-8')
    subprocess.run([str(aseprite), '-b', '--script-param', f'manifest={render_manifest}',
                    '--script-param', f'root={fixtures}', '--script-param', f'output={images}',
                    '--script', str(ROOT / 'scripts/render-animation-docs.lua')], check=True)
    for entry in manifest['animations'] + manifest['poses']:
        is_pose = 'sheet' in entry
        path = images / (entry['id'] + ('.png' if is_pose else '.gif'))
        signatures = (b'\x89PNG\r\n\x1a\n',) if is_pose else (b'GIF89a', b'GIF87a')
        if not path.is_file() or not any(path.read_bytes().startswith(signature) for signature in signatures):
            raise ValueError(f'Missing or invalid generated preview: {path}')
    for record in manifest['provenance']:
        shutil.copyfile(fixtures / 'provenance' / record['filename'], images / record['filename'])
    return markdown, images


def publish_file(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
        staged = Path(temporary.name)
    try:
        shutil.copyfile(source, staged)
        staged.chmod(0o644)
        os.replace(staged, destination)
    finally:
        staged.unlink(missing_ok=True)


def seed_catalog_animations(connection, definitions):
    connection.executemany(
        'INSERT INTO animations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [(entry['id'], entry['name'], entry['frame_width'], entry['frame_height'],
          entry['frame_count'], entry['directions'], json.dumps(entry['sequence']),
          json.dumps(entry['durations_ms'])) for entry in definitions])
    connection.commit()


def stage_catalog_docs(connection, catalog, stage, aseprite):
    definitions = catalog['animations']
    items = catalog['items']
    # A single explicit reference item prevents combining incompatible alternatives.
    if len(items) != 1:
        raise ValueError('Catalog documentation currently requires exactly one reference item')
    item = items[0]
    images = stage / 'catalog-images'
    images.mkdir()
    for entry in definitions:
        if 'timing_note' not in entry:
            raise ValueError(f"{catalog['root']}/animations.json: documentation requires timing_note for {entry['id']}")
    manifest = stage / 'catalog-render.json'
    manifest.write_text(json.dumps({'animations': definitions,
        'components': [{**component, 'path': str(component['path'])} for component in item['components']]}))
    subprocess.run([resolve_aseprite(aseprite), '-b', '--script-param', f'manifest={manifest}',
        '--script-param', f'output={images}', '--script', str(ROOT / 'scripts/render-catalog-docs.lua')], check=True)
    records = connection.execute('SELECT id,name,frame_width,frame_height,frame_count,directions,sequence,durations_ms FROM animations ORDER BY id').fetchall()
    expected = {entry['id']: entry for entry in definitions}
    rows = []
    notes = []
    for identifier, name, width, height, count, directions, sequence, durations in records:
        entry = expected[identifier]
        if (width, height, count, directions, json.loads(sequence), json.loads(durations)) != (
                entry['frame_width'], entry['frame_height'], entry['frame_count'], entry['directions'], entry['sequence'], entry['durations_ms']):
            raise ValueError(f'Database/JSON animation mismatch: {identifier}')
        preview = images / f'{identifier}.gif'
        if not preview.is_file() or preview.read_bytes()[:6] not in (b'GIF89a', b'GIF87a'):
            raise ValueError(f'Missing generated preview: {preview}')
        label = markdown_text(name)
        rows.append(f'| `{identifier}` | {label} | {width}×{height} | {directions} | {count} | ![{label}](content/images/animations/catalog/{identifier}.gif) |')
        # A missing note must not silently imply authored timing.
        notes.append(f"- `{identifier}`: sequence `{sequence}`; durations (ms) `{durations}`. " + markdown_text(entry['timing_note']))
    provenance = Path(catalog['root']) / 'provenance'
    if not provenance.is_dir():
        raise ValueError(f'Missing attribution directory: {provenance}')
    for name in ('credits-characters.txt', 'OGA-BY-3.0.txt', 'sources.json'):
        path = provenance / name
        if not path.is_file():
            raise ValueError(f'Missing attribution: {path}')
        shutil.copyfile(path, images / name)
    page = ('---\ntitle: Project animations\nstatus: reference\n---\n\n# Project animations\n\n'
        '| ID | Name | Frame size | Directions | Frames / direction | Image |\n'
        '| --- | --- | --- | --- | --- | --- |\n' + '\n'.join(rows) + '\n\n'
        '## Current selection\n\nGenerated from the prepared catalog `animations.json` and verified SQLite records. '
        'The first import slice contains one body item, without head or clothing. '
        'All normalized sheets have north, east, south, west rows (NESW); the preview faces south. '
        'Frame indexes are zero-based. Original upstream NWSE sheets remain unchanged.\n\n'
        '## Playback timing\n\n' + '\n'.join(notes) + '\n\n'
        '## Attribution\n\nSource: LPC Revised via the pinned LPC-rework checkout. '
        'Retain the [author credits](content/images/animations/catalog/credits-characters.txt), '
        '[OGA-BY 3.0 license](content/images/animations/catalog/OGA-BY-3.0.txt), and '
        '[source pins and modification record](content/images/animations/catalog/sources.json). '
        'The sample is for local development, not general production distribution approval.\n\n'
        '## Other source animations\n\nSee [[animation-reference|LPC Animation Reference]] for the broader research inventory. '
        'Upstream clips and static poses are not automatically imported. View playback still uses '
        'the existing external motion fixtures; database sprite playback is not implemented.\n')
    destination = stage / 'animations.md'
    destination.write_text(page)
    return destination, images


def build_database(source, output, *, catalog_root=None,
                   animation_manifest=ROOT / 'scripts/catalog-sample/animations.json',
                   animation_docs=None, aseprite='aseprite'):
    from catalog_import import import_catalog, load_animations

    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output:
        raise ValueError('Database output must not overwrite the SQL source')
    if animation_docs is not None and catalog_root is None:
        raise ValueError('Animation documentation requires a prepared catalog')
    if animation_docs is not None and Path(animation_docs).resolve() in (source, output):
        raise ValueError('Animation documentation must not overwrite the SQL source or database')
    if catalog_root is not None:
        inputs = Path(catalog_root).resolve()
        for destination in (output, None if animation_docs is None else Path(animation_docs).resolve()):
            if destination is not None and destination.is_relative_to(inputs):
                raise ValueError(f'Build output must not overwrite catalog inputs: {destination}')
    sql = source.read_text(encoding='utf-8')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.database-', dir=output.parent) as directory:
        stage = Path(directory)
        temporary = stage / 'db.sqlite'
        with closing(sqlite3.connect(temporary)) as connection:
            connection.execute('PRAGMA foreign_keys = ON')
            connection.executescript(sql)
            if connection.in_transaction:
                raise ValueError('SQL snapshot must not leave an open transaction')
            if catalog_root is not None:
                catalog = import_catalog(connection, Path(catalog_root).resolve())
                catalog['root'] = Path(catalog_root).resolve()
                connection.commit()
            elif animation_manifest is not None:
                # Fixture-free schema tests use the same normalized definitions, without art.
                slots = json.loads((ROOT / 'scripts/catalog-sample/slots.json').read_text())
                connection.executemany('INSERT INTO slots (id,name,icon,"order") VALUES (?,?,?,?)',
                    [(s['id'], s['name'], s['icon'], s['order']) for s in slots])
                seed_catalog_animations(connection, load_animations(Path(animation_manifest)))
            if connection.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('SQL snapshot contains broken foreign-key references')
            if connection.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise ValueError('Generated database failed SQLite integrity check')
            if animation_docs is not None:
                page, images = stage_catalog_docs(connection, catalog, stage, aseprite)
        # No output is published until import, integrity checks and rendering succeed.
        if animation_docs is not None:
            destination = Path(animation_docs).resolve()
            for image in images.iterdir():
                publish_file(image, destination.parent / 'images/animations/catalog' / image.name)
            publish_file(page, destination)
        os.replace(temporary, output)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'scripts/catalog.sql')
    parser.add_argument('--output', type=Path, default=ROOT / 'db.sqlite')
    parser.add_argument('--catalog', type=Path, default=ROOT / 'catalog')
    parser.add_argument('--animation-docs', type=Path)
    parser.add_argument('--aseprite', default='aseprite')
    args = parser.parse_args()
    print(f'Built {build_database(args.source, args.output, catalog_root=args.catalog, animation_docs=args.animation_docs, aseprite=args.aseprite)}')


if __name__ == '__main__':
    main()
