"""GPL parsing tests do not require artwork or external tools."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from catalog_palettes import parse_gpl, load_gpl, format_gpl


class PaletteTests(unittest.TestCase):
    def test_names_comments_columns_and_duplicate_rgb_entries(self):
        text = 'GIMP Palette\nName: Dungeon Theme\nColumns: 4\n# comment\n 18 22 35 Shadow\n18 22 35  Other Material\n210 198 162 Highlight\n'
        parsed = parse_gpl(text)
        self.assertEqual(parsed['name'], 'Dungeon Theme')
        self.assertEqual(parsed['columns'], 4)
        self.assertEqual(parsed['colors'], [
            {'rgb': (18, 22, 35), 'name': 'Shadow'},
            {'rgb': (18, 22, 35), 'name': 'Other Material'},
            {'rgb': (210, 198, 162), 'name': 'Highlight'}])

    def test_original_utf8_crlf_text_is_preserved(self):
        text = 'GIMP Palette\r\nName: Pâle\r\n# retained spacing\r\n  1  2  3  Couleur claire\r\n'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'pale.gpl'
            path.write_bytes(text.encode('utf-8'))
            palette = load_gpl(path)
            self.assertEqual(palette['data'].encode('utf-8'), path.read_bytes())
            self.assertEqual(palette['name'], 'Pâle')

    def test_optional_columns_and_color_names(self):
        palette = parse_gpl('GIMP Palette\nName: Simple\n0 0 0\n')
        self.assertIsNone(palette['columns'])
        self.assertEqual(palette['colors'], [{'rgb': (0, 0, 0), 'name': ''}])

    def test_invalid_format_metadata_and_rgb_fail_with_source(self):
        cases = ['', 'GIMP Palette\n1 2 3\n', 'GIMP Palette\nName: Empty\n',
                 'GIMP Palette\nName: A\nName: B\n1 2 3\n',
                 'GIMP Palette\nName: A\nColumns: x\n1 2 3\n',
                 'GIMP Palette\nName: A\nColumns: 257\n1 2 3\n',
                 'GIMP Palette\nName: A\nColumns: 0\nColumns: 0\n1 2 3\n',
                 'GIMP Palette\nName: A\n256 0 0\n',
                 'GIMP Palette\nName: A\n-1 0 0\n',
                 'GIMP Palette\nName: A\n1 2\n',
                 'GIMP Palette\nName: A\n1 2 3\nColumns: 4\n',
                 'GIMP Palette\nName: A\nUnknown: value\n1 2 3\n']
        for text in cases:
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'test.gpl:'):
                parse_gpl(text, source='test.gpl')

    def test_color_limit_reserves_transparent_index_zero(self):
        prefix = 'GIMP Palette\nName: Full\n'
        self.assertEqual(len(parse_gpl(prefix + '1 2 3\n' * 255)['colors']), 255)
        with self.assertRaisesRegex(ValueError, '255'):
            parse_gpl(prefix + '1 2 3\n' * 256)

    def test_format_omits_transparency_and_uses_neutral_color_names(self):
        text = format_gpl('Sample', [(0, 0, 0, 0), (10, 20, 30, 255)])
        self.assertEqual(parse_gpl(text)['colors'], [{'rgb': (10, 20, 30), 'name': 'Color 1'}])
        with self.assertRaises(ValueError):
            format_gpl('Sample', [(0, 0, 0, 0), (10, 20, 30, 100)])

    def test_non_utf8_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'bad.gpl'
            path.write_bytes(b'\xff')
            with self.assertRaisesRegex(ValueError, 'UTF-8'):
                load_gpl(path)


if __name__ == '__main__':
    unittest.main()
