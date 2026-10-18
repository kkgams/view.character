"""Offline checks for the research catalog; no runtime database or fixture dependency."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('lpc_catalog', ROOT / 'scripts/validate_lpc_animations.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LpcCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(module.CATALOG.read_text())

    def validate_changed(self, change):
        catalog = copy.deepcopy(self.catalog)
        change(catalog)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'catalog.json'
            path.write_text(json.dumps(catalog))
            return module.validate(path)

    def test_pinned_assets_provenance_and_frame_bounds(self):
        report = module.validate()
        self.assertEqual(report['verified_canonical_animations'],
                         {'original': 6, 'extended': 11, 'community': 2})
        self.assertEqual(report['verified_variants'], 60)

    def test_original_inventory_and_unified_sheet_are_different_orders(self):
        original = [a['source_name'] for a in self.catalog['animations'] if a['layout_id'] == 'original-separate']
        legacy = [a['source_name'] for a in self.catalog['animations'] if a['layout_id'] == 'legacy-21-row']
        self.assertEqual(original, ['walkcycle', 'hurt', 'slash', 'spellcast'])
        self.assertEqual(legacy, ['spellcast', 'thrust', 'walkcycle', 'slash', 'shoot', 'hurt'])
        female_cast = next(a for a in self.catalog['assets'] if a['path'].endswith('/female_spellcast.png'))
        self.assertEqual(female_cast['dimensions'], [448, 258])
        self.assertEqual(female_cast['trailing_padding_px'], {'bottom': 2})

    def test_physical_walk_and_preview_sequence_are_not_conflated(self):
        walk = next(a for a in self.catalog['animations'] if a['id'] == 'universal.preview.walk')
        self.assertEqual(walk['frame_counts']['south'], 9)
        self.assertEqual(walk['playback_order']['south'], list(range(1, 9)))
        self.assertIsNone(walk['fps'])
        self.assertIsNone(walk['loop'])
        self.assertEqual(walk['generator_preview']['fps'], 8)

    def test_jump_and_backslash_generations_are_not_merged(self):
        entries = {a['id']: a for a in self.catalog['animations']}
        for identifier, count in [('jump-2021.jump', 5), ('revised.jump', 6),
                                  ('universal.strip.jump', 5), ('revised.combat_1h_backslash', 12),
                                  ('universal.strip.backslash', 13)]:
            self.assertEqual(entries[identifier]['frame_counts']['south'], count)
        self.assertIsNone(entries['revised.jump']['order'])
        self.assertFalse(entries['universal.composite.jump']['verified'])

    def test_preview_definitions_match_retained_source_exactly(self):
        text = (ROOT / 'assets/lpc/sources/universal/sources/state/constants.ts').read_text()
        definitions = text.split('export const ANIMATION_CONFIGS = {', 1)[1].split('};', 1)[0]
        matches = re.findall(r'"?([a-z0-9_]+)"?:\s*\{\s*row:\s*(\d+),\s*num:\s*(\d+),\s*cycle:\s*\[([^]]+)\]', definitions)
        entries = [a for a in self.catalog['animations'] if a['layout_id'] == 'universal-preview-local']
        self.assertEqual([a['source_name'] for a in entries], [m[0] for m in matches])
        self.assertEqual(len(entries), 17)
        for entry, (_, row, num, cycle) in zip(entries, matches):
            self.assertEqual(entry['composite_start_row'], int(row))
            self.assertEqual(len(entry['directions']), int(num))
            for sequence in entry['playback_order'].values():
                self.assertEqual(sequence, [int(value) for value in cycle.split(',') if value.strip()])

    def test_missing_archive_member_restores_without_network_or_overwrite(self):
        spec = importlib.util.spec_from_file_location('fetch_lpc', ROOT / 'scripts/fetch_lpc_catalog.py')
        fetcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fetcher)
        archive = next(a for a in self.catalog['assets'] if a['path'].endswith('push_and_carry.zip'))
        member = next(a for a in self.catalog['assets'] if a['path'].endswith('/male/push.png'))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / archive['path']
            target.parent.mkdir(parents=True)
            target.write_bytes((ROOT / archive['path']).read_bytes())
            (root / 'assets/lpc/animations.json').write_text(json.dumps({'assets': [archive, member]}))
            fetcher.fetch(root)
            restored = root / member['path']
            self.assertEqual(restored.read_bytes(), (ROOT / member['path']).read_bytes())
            restored.write_bytes(b'customized')
            with self.assertRaisesRegex(ValueError, 'not overwritten'):
                fetcher.fetch(root)
            self.assertEqual(restored.read_bytes(), b'customized')

    def test_7z_extraction_uses_seekable_input(self):
        spec = importlib.util.spec_from_file_location('fetch_lpc', ROOT / 'scripts/fetch_lpc_catalog.py')
        fetcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fetcher)
        member = copy.deepcopy(next(a for a in self.catalog['assets'] if a['source'] == 'jump-2021'))
        packed = b'synthetic non-ZIP archive boundary test; not artwork'
        member['archive_sha256'] = hashlib.sha256(packed).hexdigest()
        payload = (ROOT / member['path']).read_bytes()

        def unpack(arguments, **kwargs):
            self.assertEqual(arguments[:2], ['tar', '-xOf'])
            self.assertEqual(Path(arguments[2]).read_bytes(), packed)
            self.assertEqual(arguments[3], member['archive_member'])
            return fetcher.subprocess.CompletedProcess(arguments, 0, stdout=payload)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'assets/lpc').mkdir(parents=True)
            (root / 'assets/lpc/animations.json').write_text(json.dumps({'assets': [member]}))
            with patch.object(fetcher.urllib.request, 'urlopen', return_value=io.BytesIO(packed)), \
                    patch.object(fetcher.subprocess, 'run', side_effect=unpack):
                fetcher.fetch(root)
            self.assertEqual((root / member['path']).read_bytes(), payload)

    def test_alphabetical_sort_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'reordered'):
            self.validate_changed(lambda c: c['animations'].sort(key=lambda a: a['name']))

    def test_bad_frame_reference_is_rejected(self):
        def corrupt(c):
            a = next(a for a in c['animations'] if a['id'] == 'universal.preview.walk')
            a['playback_order']['south'].append(9)
        with self.assertRaisesRegex(ValueError, 'absent pose'):
            self.validate_changed(corrupt)

    def test_guide_and_custom_body_references_are_checked(self):
        def invalid_guide(c):
            entry = next(a for a in c['animations'] if a.get('timing_profiles'))
            entry['timing_profiles'][0]['sequence'][0] = 999
        with self.assertRaisesRegex(ValueError, 'Guide references absent pose'):
            self.validate_changed(invalid_guide)

        def invalid_custom(c):
            entry = next(a for a in c['animations'] if a['id'] == 'universal.custom.tool_rod')
            entry['body_pose_references'][0][0] = 'thrust-n,999'
        with self.assertRaisesRegex(ValueError, 'Custom body reference'):
            self.validate_changed(invalid_custom)

    def test_bad_hash_or_licensing_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Hash mismatch'):
            self.validate_changed(lambda c: c['assets'][0].update(sha256='0' * 64))
        with self.assertRaisesRegex(ValueError, 'license/attribution'):
            self.validate_changed(lambda c: c['assets'][0].update(license=None))

    def test_png_corruption_is_rejected(self):
        path = ROOT / next(a['path'] for a in self.catalog['assets'] if a.get('dimensions'))
        data = bytearray(path.read_bytes())
        data[20] ^= 1
        with self.assertRaisesRegex(ValueError, 'checksum'):
            module.png_dimensions(data)


if __name__ == '__main__':
    unittest.main()
