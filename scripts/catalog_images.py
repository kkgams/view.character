"""Lossless, standard-library PNG I/O for catalog preparation.

No color conversion, quantization, or catalog-specific transparency policy is
applied. Unsupported PNG encodings and malformed data raise path-qualified
ValueError; filesystem errors retain their normal OSError type.
"""
from pathlib import Path
import struct
import zlib


_SIGNATURE = b'\x89PNG\r\n\x1a\n'


def _paeth(a, b, c):
    p = a + b - c
    distances = (abs(p - a), abs(p - b), abs(p - c))
    return (a, b, c)[distances.index(min(distances))]


def read_png(path):
    """Return width, height, RGBA pixels, RGBA palette, and unpacked indices.

    Palette and indices are None for RGB/RGBA images. Indexed PNGs support
    depths 1/2/4/8; RGB and RGBA require depth 8. Interlacing is unsupported.
    """
    path = Path(path)

    def fail(message):
        raise ValueError(f'{path}: {message}')

    data = path.read_bytes()
    if not data.startswith(_SIGNATURE):
        fail('invalid PNG signature')
    position = len(_SIGNATURE)
    header = None
    palette_data = transparency = None
    compressed = bytearray()
    seen_idat = ended_idat = ended = False
    while position < len(data):
        if len(data) - position < 12:
            fail('truncated PNG chunk')
        length, kind = struct.unpack_from('>I4s', data, position)
        if length > 0x7fffffff:
            fail('invalid PNG chunk length')
        end = position + 12 + length
        if end > len(data):
            fail('truncated PNG chunk payload')
        payload = data[position + 8:end - 4]
        crc = struct.unpack_from('>I', data, end - 4)[0]
        if zlib.crc32(kind + payload) != crc:
            fail(f'CRC mismatch in {kind!r}')
        if any(not (65 <= value <= 90 or 97 <= value <= 122) for value in kind) or kind[2] & 32:
            fail('invalid PNG chunk type')
        position = end
        if header is None and kind != b'IHDR':
            fail('IHDR must be first')
        if seen_idat and kind != b'IDAT':
            ended_idat = True
        if kind == b'IHDR':
            if header is not None or length != 13:
                fail('invalid or duplicate IHDR')
            header = struct.unpack('>IIBBBBB', payload)
            width, height, depth, color, compression, filtering, interlace = header
            if not (0 < width <= 0x7fffffff and 0 < height <= 0x7fffffff):
                fail('invalid PNG dimensions')
            if color not in (2, 3, 6) or depth not in ((1, 2, 4, 8) if color == 3 else (8,)):
                fail(f'unsupported PNG color type/depth: {color}/{depth}')
            if compression != 0 or filtering != 0 or interlace != 0:
                fail('unsupported PNG compression, filter method, or interlace')
        elif kind == b'PLTE':
            if palette_data is not None or seen_idat or transparency is not None:
                fail('duplicate or misplaced PLTE')
            if not length or length % 3 or length > 768:
                fail('invalid PLTE length')
            if color == 3 and length // 3 > 1 << depth:
                fail('palette exceeds indexed bit depth')
            palette_data = payload
        elif kind == b'tRNS':
            if transparency is not None or seen_idat:
                fail('duplicate or misplaced tRNS')
            if color == 3:
                if palette_data is None or not 0 < length <= len(palette_data) // 3:
                    fail('invalid indexed tRNS')
            elif color == 2:
                if length != 6 or any(v > 255 for v in struct.unpack('>HHH', payload)):
                    fail('invalid RGB tRNS')
            else:
                fail('tRNS is forbidden for RGBA')
            transparency = payload
        elif kind == b'IDAT':
            if ended_idat:
                fail('IDAT chunks must be consecutive')
            if color == 3 and palette_data is None:
                fail('indexed PNG requires PLTE before IDAT')
            seen_idat = True
            compressed.extend(payload)
        elif kind == b'IEND':
            if length or not seen_idat:
                fail('invalid IEND or missing IDAT')
            if position != len(data):
                fail('trailing data after IEND')
            ended = True
            break
        elif not kind[0] & 32:
            fail(f'unsupported critical chunk {kind!r}')
    if not ended:
        fail('missing IEND')

    channels = {2: 3, 3: 1, 6: 4}[color]
    stride = (width * channels * depth + 7) // 8
    expected = height * (stride + 1)
    inflater = zlib.decompressobj()
    try:
        raw = inflater.decompress(compressed, expected + 1)
    except zlib.error as error:
        fail(f'invalid PNG compressed data: {error}')
    if len(raw) != expected or not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
        fail('PNG decompressed size or stream termination mismatch')

    palette = None
    if color == 3:
        palette = []
        for index in range(len(palette_data) // 3):
            alpha = transparency[index] if transparency is not None and index < len(transparency) else 255
            palette.append(tuple(palette_data[index * 3:index * 3 + 3]) + (alpha,))
    rgb_key = struct.unpack('>HHH', transparency) if color == 2 and transparency is not None else None
    indices = bytearray() if color == 3 else None
    pixels = []
    previous = bytearray(stride)
    bpp = max(1, (channels * depth + 7) // 8)
    for y in range(height):
        start = y * (stride + 1)
        filter_type = raw[start]
        if filter_type > 4:
            fail(f'invalid PNG filter {filter_type} on row {y}')
        row = bytearray(raw[start + 1:start + 1 + stride])
        for x in range(stride):
            left = row[x - bpp] if x >= bpp else 0
            above = previous[x]
            upper_left = previous[x - bpp] if x >= bpp else 0
            if filter_type == 4:
                predictor = _paeth(left, above, upper_left)
            else:
                predictor = (0, left, above, (left + above) // 2)[filter_type]
            row[x] = (row[x] + predictor) & 255
        if color == 3:
            for x in range(width):
                bit = x * depth
                index = (row[bit // 8] >> (8 - depth - bit % 8)) & ((1 << depth) - 1)
                if index >= len(palette):
                    fail(f'palette index {index} out of range on row {y}')
                indices.append(index)
                pixels.append(palette[index])
        else:
            for x in range(0, stride, channels):
                sample = tuple(row[x:x + channels])
                pixels.append(sample if color == 6 else sample + (0 if sample == rgb_key else 255,))
        previous = row
    return {'width': width, 'height': height, 'pixels': pixels,
            'palette': palette, 'indices': bytes(indices) if indices is not None else None}


def _chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))


def write_indexed(path, width, height, indices, palette):
    """Write an 8-bit indexed PNG, preserving palette order and all RGBA bytes."""
    path = Path(path)

    def fail(message):
        raise ValueError(f'{path}: {message}')

    if any(type(value) is not int or not 0 < value <= 0x7fffffff for value in (width, height)):
        fail('width and height must be positive PNG integers')
    try:
        palette = list(palette)
        valid_palette = 1 <= len(palette) <= 256 and all(
            len(entry) == 4 and all(type(v) is int and 0 <= v <= 255 for v in entry)
            for entry in palette)
    except TypeError:
        fail('palette must contain 1..256 RGBA byte entries')
    if not valid_palette:
        fail('palette must contain 1..256 RGBA byte entries')
    if isinstance(indices, int):
        fail('indices must be a byte sequence')
    try:
        indices = bytes(indices)
    except (TypeError, ValueError, OverflowError):
        fail('indices must be a byte sequence')
    if len(indices) != width * height:
        fail('index count does not match dimensions')
    if max(indices) >= len(palette):
        fail('palette index out of range')
    raw = b''.join(b'\0' + indices[y * width:(y + 1) * width] for y in range(height))
    output = (_SIGNATURE + _chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 3, 0, 0, 0))
              + _chunk(b'PLTE', bytes(v for entry in palette for v in entry[:3]))
              + _chunk(b'tRNS', bytes(entry[3] for entry in palette))
              + _chunk(b'IDAT', zlib.compress(raw)) + _chunk(b'IEND', b''))
    path.write_bytes(output)
