"""Prepare the bounded, lossless indexed Walk catalog; never overwrite local edits."""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile

from catalog_images import read_png, write_indexed
from catalog_palettes import format_gpl

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def pinned_image(path, digest):
    require(path.is_file(), f'Missing {path}; run make animation-fixtures fixtures first')
    require(hashlib.sha256(path.read_bytes()).hexdigest() == digest, f'Pinned hash mismatch: {path}')
    return read_png(path)


def reorder_rows(pixels, width, frame_height):
    """LPC NWSE -> catalog NESW, without changing any frame pixels."""
    require(len(pixels) == width * frame_height * 4, 'Expected four direction rows')
    size = width * frame_height
    return [pixel for row in (0, 3, 2, 1) for pixel in pixels[row * size:(row + 1) * size]]


def extract_icon(image):
    require((image['width'], image['height']) == (192, 256), 'Unexpected Idle source geometry')
    points = [(x, y) for y in range(64) for x in range(64)
              if image['pixels'][(128 + y) * 192 + x][3] != 0]
    require(bool(points), 'Empty south-facing Idle source')
    left, right = min(x for x, _ in points), max(x for x, _ in points)
    top, bottom = min(y for _, y in points), max(y for _, y in points)
    width, height = right - left + 1, bottom - top + 1
    require(width <= 32 and height <= 32, 'Icon would require rescaling')
    pixels = [(0, 0, 0, 0)] * 1024
    for y in range(height):
        for x in range(width):
            pixels[(y + (32 - height) // 2) * 32 + x + (32 - width) // 2] = image['pixels'][(128 + top + y) * 192 + left + x]
    return pixels


def indexed_images(images):
    # One mapping across ALL sheets and the icon. Never quantize or shift indexes.
    palette = [(0, 0, 0, 0)]
    for pixels in images:
        for pixel in pixels:
            require(pixel[3] in (0, 255), 'Partial alpha cannot be converted losslessly to this catalog')
            if pixel[3] and pixel not in palette:
                palette.append(pixel)
    require(len(palette) <= 256, 'Item needs more than 255 visible colors; quantization is not allowed')
    lookup = {color: index for index, color in enumerate(palette)}
    return palette, [bytes(lookup[pixel] if pixel[3] else 0 for pixel in pixels) for pixels in images]


def prepare_catalog(output, *, project=ROOT):
    output, project = Path(output), Path(project)
    sources = json.loads((project / 'scripts/lpc-fixtures.json').read_text())
    motions = json.loads((project / 'scripts/lpc-animations.json').read_text())
    source = next(item for item in sources['items'] if item['id'] == 'body')
    walk = next(item for item in motions['animations'] if item['id'] == 'walk')
    require(sources['revision'] == motions['revision'], 'Source revision mismatch')
    original_path = project / 'fixtures/lpc-animations/originals/body/walk_10.png'
    original = pinned_image(original_path, walk['body']['sha256'])
    idle = pinned_image(project / 'fixtures/lpc/originals/body.png', source['sha256'])
    require((original['width'], original['height']) == (512, 256), 'Unexpected Walk source geometry')
    animations = json.loads((project / 'scripts/catalog-sample/animations.json').read_text())
    require(len(animations) == 1, 'Sample must define Walk only')
    definition = animations[0]
    require((definition['id'], definition['frame_width'], definition['frame_height'], definition['frame_count'], definition['directions']) == ('walk', 64, 64, walk['frames'], 'NESW'), 'Sample/source geometry mismatch')
    require(definition['sequence'] == walk['preview_sequence'] and definition['durations_ms'] == walk['preview_duration_ms'], 'Sample/source timing mismatch')
    reordered = reorder_rows(original['pixels'], original['width'], 64)
    icon = extract_icon(idle)
    palette, (sheet_indices, icon_indices) = indexed_images([reordered, icon])
    require(not output.is_symlink(), f'Refusing symlink: {output}')
    require(not output.exists() or output.is_dir(), f'Expected catalog directory: {output}')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.catalog-', dir=output.parent) as directory:
        stage = Path(directory)
        item = stage / 'items/body/masculine-thin'
        item.mkdir(parents=True)
        write_indexed(item / 'walk_10.png', 512, 256, sheet_indices, palette)
        write_indexed(item / 'icon.png', 32, 32, icon_indices, palette)
        for name in ('animations.json', 'slots.json'):
            (stage / name).write_bytes((project / 'scripts/catalog-sample' / name).read_bytes())
        (item / 'data.json').write_text(json.dumps({'name': source['name'], 'palette': 'body-ivory'}, indent=2) + '\n')
        (stage / 'palettes').mkdir()
        (stage / 'palettes/body-ivory.gpl').write_text(format_gpl(source['name'] + ' — ' + source['source_ramp'], palette), encoding='utf-8')
        provenance = stage / 'provenance'
        provenance.mkdir()
        for record in motions['provenance']:
            path = project / 'fixtures/lpc-animations/provenance' / record['filename']
            require(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256'], f'Pinned provenance mismatch: {path}')
            (provenance / record['filename']).write_bytes(path.read_bytes())
        (provenance / 'sources.json').write_text(json.dumps({
            'repository': motions['repository'], 'revision': motions['revision'],
            'walk': walk['body'], 'icon': source,
            'changes': ['Walk rows NWSE -> NESW (0,3,2,1)', 'Shared lossless indexed palette; transparent pixels use index 0',
                        '32x32 icon cropped/centered from south-facing Idle frame 0; no rescaling'],
            'license': 'OGA-BY-3.0', 'credits': 'credits-characters.txt'
        }, indent=2) + '\n')
        (stage / 'README.md').write_text('# Local Walk catalog sample\n\nBody only; no head, clothes, masks or fabricated directions.\n'
            'Source: justgook/LPC-rework at ' + motions['revision'] + '.\n'
            'See provenance/ for author credits, OGA-BY 3.0 and exact modifications.\n'
            'Original RGBA inputs remain unchanged. This is not production distribution approval.\n')
        # Check every existing file before publishing any missing file.
        for path in stage.rglob('*'):
            if path.is_file():
                destination = output / path.relative_to(stage)
                for relative in (path.relative_to(stage), *path.relative_to(stage).parents):
                    candidate = output / relative
                    require(not candidate.is_symlink(), f'Refusing symlink: {candidate}')
                require(not destination.exists() or destination.read_bytes() == path.read_bytes(),
                        f'Existing catalog differs: {destination}; preserve edits, or choose another CATALOG path')
        for path in stage.rglob('*'):
            if path.is_file():
                destination = output / path.relative_to(stage)
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not destination.exists():
                    destination.write_bytes(path.read_bytes())
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'catalog')
    args = parser.parse_args()
    print(f'Prepared {prepare_catalog(args.output)}: one indexed Walk item, NESW, shared palette')
