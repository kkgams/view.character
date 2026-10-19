"""Fixture-independent tests of the lossless catalog PNG API."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

spec = importlib.util.spec_from_file_location(
    'catalog_images', Path(__file__).resolve().parents[1] / 'scripts/catalog_images.py')
images = importlib.util.module_from_spec(spec)
spec.loader.exec_module(images)


def chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))


def png(raw, width=2, height=1, depth=8, color=6, extra=b'', compressed=None, interlace=0):
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, depth, color, 0, 0, interlace))
            + extra + chunk(b'IDAT', zlib.compress(raw) if compressed is None else compressed)
            + chunk(b'IEND', b''))


class CatalogImagesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'sample.png'

    def read(self, data):
        self.path.write_bytes(data)
        return images.read_png(self.path)

    def rejected(self, data):
        with self.assertRaises(ValueError) as caught:
            self.read(data)
        self.assertIn(str(self.path), str(caught.exception))

    def test_indexed_round_trip_preserves_order_hidden_rgb_and_partial_alpha(self):
        palette = [(91, 12, 23, 0), (1, 2, 3, 255), (4, 5, 6, 127), (7, 8, 9, 0)]
        indices = bytes([0, 1, 2, 3, 3, 2, 1, 0])
        images.write_indexed(self.path, 4, 2, indices, palette)
        result = images.read_png(self.path)
        self.assertEqual(result, {'width': 4, 'height': 2, 'indices': indices,
                                  'palette': palette, 'pixels': [palette[i] for i in indices]})
        self.assertEqual(self.path.read_bytes()[24:26], b'\x08\x03')

    def test_full_256_color_palette(self):
        palette = [(i, 255 - i, i, 255) for i in range(256)]
        images.write_indexed(self.path, 256, 1, bytes(range(256)), palette)
        self.assertEqual(images.read_png(self.path)['palette'], palette)

    def test_packed_indexed_depths_and_row_padding(self):
        for depth in (1, 2, 4, 8):
            with self.subTest(depth=depth):
                count = 1 << depth
                rgb = bytes(v for i in range(count) for v in (i, i, i))
                samples = [0, count - 1, 1]
                packed = bytearray((len(samples) * depth + 7) // 8)
                for x, value in enumerate(samples):
                    packed[x * depth // 8] |= value << (8 - depth - x * depth % 8)
                result = self.read(png(b'\0' + packed + b'\0' + packed, width=3, height=2,
                                       depth=depth, color=3,
                                       extra=chunk(b'PLTE', rgb) + chunk(b'tRNS', b'\0')))
                self.assertEqual(result['indices'], bytes(samples * 2))
                self.assertEqual(result['palette'][0], (0, 0, 0, 0))
                self.assertEqual(result['palette'][-1][-1], 255)

    def test_rgb_and_rgba_all_five_filters(self):
        def paeth(a, b, c):
            p = a + b - c
            return min((a, b, c), key=lambda value: abs(p - value))

        for color, channels in ((2, 3), (6, 4)):
            rows = [bytes((i * 31 + y * 73) % 256 for i in range(3 * channels)) for y in range(5)]
            raw = bytearray()
            previous = bytes(3 * channels)
            for kind, row in enumerate(rows):
                raw.append(kind)
                for x, value in enumerate(row):
                    a = row[x - channels] if x >= channels else 0
                    b = previous[x]
                    c = previous[x - channels] if x >= channels else 0
                    predictor = (0, a, b, (a + b) // 2, paeth(a, b, c))[kind]
                    raw.append((value - predictor) % 256)
                previous = row
            result = self.read(png(bytes(raw), width=3, height=5, color=color))
            expected = [tuple(row[x:x + channels]) + ((255,) if color == 2 else ())
                        for row in rows for x in range(0, len(row), channels)]
            self.assertEqual(result['pixels'], expected)
            self.assertIsNone(result['palette'])
            self.assertIsNone(result['indices'])

    def test_rgb_transparency_key(self):
        result = self.read(png(b'\0\x01\x02\x03\x04\x05\x06', color=2,
                               extra=chunk(b'tRNS', struct.pack('>HHH', 1, 2, 3))))
        self.assertEqual(result['pixels'], [(1, 2, 3, 0), (4, 5, 6, 255)])

    def test_corruption_and_truncation(self):
        good = png(b'\0' + bytes(8))
        broken_crc = bytearray(good)
        broken_crc[-1] ^= 1
        for data in (b'not PNG', bytes(broken_crc), good[:-1], good[:20], good + b'extra'):
            with self.subTest(data=data):
                self.rejected(data)

    def test_bad_filters_sizes_and_compressed_streams(self):
        for raw in (b'\x05' + bytes(8), b'\0' + bytes(7), b'\0' + bytes(9)):
            self.rejected(png(raw))
        compressed = zlib.compress(b'\0' + bytes(8))
        for stream in (b'garbage', compressed[:-1], compressed + b'extra', compressed * 2):
            self.rejected(png(b'', compressed=stream))

    def test_malformed_chunks_and_unsupported_encodings(self):
        for data in (
            png(b'\0' + bytes(8), interlace=1),
            png(b'\0' + bytes(8), depth=16),
            png(b'\0' + bytes(8), color=0),
            png(b'\0' + bytes(8), width=0),
            png(b'\0' + bytes(8), extra=chunk(b'ABCD', b'')),
            png(b'\0' + bytes(8), extra=chunk(b'tRNS', b'\0')),
            png(b'\0\0\0', color=3),
            png(b'\0\x01\0', color=3, extra=chunk(b'PLTE', b'\0\0\0')),
            png(b'\0\0\0', color=3, extra=chunk(b'PLTE', b'\0')),
            png(b'\0\0\0', color=3, extra=chunk(b'PLTE', b'\0\0\0') + chunk(b'tRNS', b'\0\0')),
        ):
            with self.subTest(data=data):
                self.rejected(data)

    def test_idat_ordering_and_missing_end(self):
        header = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 1, 8, 6, 0, 0, 0))
        compressed = zlib.compress(b'\0' + bytes(8))
        parts = chunk(b'IDAT', compressed[:3]) + chunk(b'IDAT', compressed[3:])
        self.assertEqual(len(self.read(header + parts + chunk(b'IEND', b''))['pixels']), 2)
        self.rejected(header + parts)
        self.rejected(header + chunk(b'IEND', b''))
        self.rejected(header + chunk(b'IDAT', compressed[:3]) + chunk(b'tEXt', b'key\0value')
                      + chunk(b'IDAT', compressed[3:]) + chunk(b'IEND', b''))

    def test_writer_rejects_invalid_inputs_with_path(self):
        for width, height, indices, palette in (
            (0, 1, b'', [(0, 0, 0, 0)]),
            (True, 1, b'\0', [(0, 0, 0, 0)]),
            (1, 1, b'\0', []),
            (1, 1, b'\0', [(0, 0, 256, 255)]),
            (1, 1, b'\0', [(0, 0, 0)]),
            (1, 1, b'\x01', [(0, 0, 0, 0)]),
            (1, 1, b'', [(0, 0, 0, 0)]),
            (1, 1, 1, [(0, 0, 0, 0)]),
        ):
            with self.subTest(values=(width, height, indices, palette)):
                with self.assertRaises(ValueError) as caught:
                    images.write_indexed(self.path, width, height, indices, palette)
                self.assertIn(str(self.path), str(caught.exception))


if __name__ == '__main__':
    unittest.main()
