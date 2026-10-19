"""GIMP Palette parsing; preserve source text and ordered, named RGB entries."""
from pathlib import Path
import re


def parse_gpl(text, *, source='<palette>'):
    def fail(line, message):
        raise ValueError(f'{source}:{line}: {message}')

    lines = text.splitlines()
    if not lines or lines[0] != 'GIMP Palette':
        fail(1, 'expected GIMP Palette header')
    name, columns, colors = None, None, []
    for number, line in enumerate(lines[1:], 2):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        if stripped.startswith(('Name:', 'Columns:')):
            if colors:
                fail(number, 'palette metadata must precede colors')
            key, value = stripped.split(':', 1)
            value = value.strip()
            if key == 'Name':
                if name is not None or not value:
                    fail(number, 'Name must occur once and be nonempty')
                name = value
            else:
                if columns is not None or not re.fullmatch(r'[0-9]+', value) or not 0 <= int(value) <= 256:
                    fail(number, 'Columns must occur at most once and be an integer from 0 to 256')
                columns = int(value)
            continue
        match = re.fullmatch(r'\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)(?:\s+(.*))?', line)
        if match is None:
            fail(number, 'expected RGB integers followed by an optional color name')
        rgb = tuple(int(value) for value in match.groups()[:3])
        if any(value > 255 for value in rgb):
            fail(number, 'RGB components must be between 0 and 255')
        colors.append({'rgb': rgb, 'name': (match.group(4) or '').strip()})
        if len(colors) > 255:
            fail(number, 'at most 255 colors are supported; PNG index 0 is reserved for transparency')
    if name is None:
        fail(1, 'missing Name metadata')
    if not colors:
        fail(1, 'palette requires at least one color')
    return {'name': name, 'columns': columns, 'colors': colors}


def load_gpl(path):
    path = Path(path)
    # read_text() normalizes CRLF; raw UTF-8 decoding preserves the exact source.
    try:
        text = path.read_bytes().decode('utf-8')
    except UnicodeDecodeError as error:
        raise ValueError(f'{path}: GPL must be UTF-8 text') from error
    return {**parse_gpl(text, source=path), 'data': text}


def format_gpl(name, palette):
    """Write derived fixture colors; no inferred semantic color names."""
    if not name.strip() or '\n' in name or '\r' in name:
        raise ValueError('Palette name must be nonempty single-line text')
    if not palette or palette[0][3] != 0 or any(color[3] != 255 for color in palette[1:]):
        raise ValueError('Expected transparent index 0 and opaque visible palette entries')
    text = f'GIMP Palette\nName: {name}\nColumns: 0\n# PNG index 0 is transparent; entries below map to indexes 1..N.\n'
    text += ''.join(f'{r:3} {g:3} {b:3}  Color {index}\n'
                    for index, (r, g, b, _) in enumerate(palette[1:], 1))
    parse_gpl(text)
    return text
