import importlib.util
import shutil
import tempfile
from unittest.mock import patch
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('prepare_catalog', ROOT / 'scripts/prepare-catalog.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class CatalogPreparationTests(unittest.TestCase):
    def test_nwse_to_nesw_preserves_pixels_and_columns(self):
        rows = [(n, n, n, 255) for n in range(16)]
        converted = prepare.reorder_rows(rows, 2, 2)
        self.assertEqual(converted, rows[:4] + rows[12:] + rows[8:12] + rows[4:8])

    def test_palette_is_shared_losslessly_including_icon_only_colors(self):
        red, blue, clear = (255, 0, 0, 255), (0, 0, 255, 255), (91, 92, 93, 0)
        palette, images = prepare.indexed_images([[clear, red], [blue, red]])
        self.assertEqual(palette, [(0, 0, 0, 0), red, blue])
        self.assertEqual(images, [bytes([0, 1]), bytes([2, 1])])
        self.assertEqual([palette[index] for index in images[1]], [blue, red])

    def test_preparation_is_repeatable_and_refuses_changed_catalog_before_publishing(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            (project / 'scripts').mkdir()
            for name in ('lpc-fixtures.json', 'lpc-animations.json'):
                shutil.copyfile(ROOT / 'scripts' / name, project / 'scripts' / name)
            shutil.copytree(ROOT / 'scripts/catalog-sample', project / 'scripts/catalog-sample')
            provenance = project / 'fixtures/lpc-animations/provenance'
            provenance.mkdir(parents=True)
            for name in ('credits-characters.txt', 'OGA-BY-3.0.txt'):
                shutil.copyfile(ROOT / 'docs/images/animations/catalog' / name, provenance / name)
            clear, color = (0, 0, 0, 0), (10, 20, 30, 255)
            sheet = {'width': 512, 'height': 256, 'pixels': [color] * (512 * 256)}
            idle = {'width': 192, 'height': 256, 'pixels': [clear] * (192 * 256)}
            idle['pixels'][128 * 192] = color
            output = project / 'catalog'
            with patch.object(prepare, 'pinned_image', side_effect=lambda path, digest: sheet if path.name == 'walk_10.png' else idle):
                prepare.prepare_catalog(output, project=project)
                original = (output / 'items/body/masculine-thin/walk_10.png').read_bytes()
                self.assertEqual(json.loads((output / 'items/body/masculine-thin/data.json').read_text())['palette'], 'body-ivory')
                gpl = (output / 'palettes/body-ivory.gpl').read_text()
                self.assertIn('GIMP Palette', gpl)
                self.assertIn('10  20  30', gpl)
                prepare.prepare_catalog(output, project=project)
                self.assertEqual((output / 'items/body/masculine-thin/walk_10.png').read_bytes(), original)
                (output / 'animations.json').write_text('local edit')
                (output / 'slots.json').unlink()
                with self.assertRaisesRegex(ValueError, 'preserve edits'):
                    prepare.prepare_catalog(output, project=project)
                self.assertEqual((output / 'animations.json').read_text(), 'local edit')
                self.assertFalse((output / 'slots.json').exists())

    def test_partial_alpha_and_too_many_colors_fail_instead_of_quantizing(self):
        with self.assertRaisesRegex(ValueError, 'alpha'):
            prepare.indexed_images([[(1, 2, 3, 127)]])
        with self.assertRaisesRegex(ValueError, 'quantization'):
            prepare.indexed_images([[(n % 256, n // 256, 0, 255) for n in range(256)]])

    def test_icon_is_cropped_and_centered_without_rescaling(self):
        pixels = [(0, 0, 0, 0)] * (192 * 256)
        color = (20, 30, 40, 255)
        pixels[130 * 192 + 12] = color
        icon = prepare.extract_icon({'width': 192, 'height': 256, 'pixels': pixels})
        self.assertEqual(len(icon), 1024)
        self.assertEqual(icon[15 * 32 + 15], color)
        self.assertEqual(icon.count(color), 1)


if __name__ == '__main__':
    unittest.main()
