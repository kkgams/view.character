import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('animation_builder', ROOT / 'scripts/build-database.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class AnimationDocsTests(unittest.TestCase):
    def setUp(self):
        self.manifest = builder.load_animation_manifest()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def database(self):
        connection = sqlite3.connect(':memory:')
        self.addCleanup(connection.close)
        connection.execute('CREATE TABLE animations (id TEXT PRIMARY KEY, name TEXT NOT NULL)')
        builder.seed_animations(connection, self.manifest)
        return connection

    def test_complete_verified_inventory_and_layout_exception(self):
        self.assertEqual(len(self.manifest['animations']), 10)
        self.assertEqual({entry['id'] for entry in self.manifest['animations']}, {
            'climb', 'combat_1h_backslash', 'combat_1h_halfslash', 'combat_1h_idle',
            'combat_1h_slash', 'idle', 'jump', 'legacy_swing', 'run', 'walk'})
        for entry in self.manifest['animations']:
            self.assertEqual(len(entry['directions']), 1 if entry['id'] == 'climb' else 4)
            self.assertEqual(entry['preview_direction'], 'north' if entry['id'] == 'climb' else 'south')
        idle = next(entry for entry in self.manifest['animations'] if entry['id'] == 'idle')
        self.assertEqual(idle['preview_sequence'], [0, 1, 2, 1])
        self.assertEqual(idle['preview_duration_ms'], [400, 100, 400, 100])

    def test_table_names_come_from_database_and_are_escaped(self):
        connection = self.database()
        connection.execute("UPDATE animations SET name=? WHERE id='idle'", ('Rest | <&>',))
        page = builder.animation_markdown(connection, self.manifest)
        self.assertIn('| ID | Name | Directions | Frames | Image |', page)
        self.assertIn('Rest &#124; &lt;&amp;&gt;', page)
        self.assertEqual(page.count('](content/images/animations/') - 2, 17)  # previews, credits, license
        connection.execute("INSERT INTO animations VALUES ('unknown', 'Unknown')")
        with self.assertRaisesRegex(ValueError, 'IDs do not match'):
            builder.animation_markdown(connection, self.manifest)

    def test_categories_keep_source_order_and_evidence_follows_all_tables(self):
        page = builder.animation_reference_markdown(self.manifest)
        headings = ['## A. Original / legacy LPC', '## B. Extended LPC',
                    '## C. Community / bonus', '## Licenses and attribution',
                    '## Historical evidence and compatibility']
        self.assertEqual([page.index(heading) for heading in headings],
                         sorted(page.index(heading) for heading in headings))
        self.assertLess(page.rindex('\n|'), page.index('## Licenses and attribution'))
        revised = page.split('### LPC Revised: source-specific versions', 1)[1].split('## C.', 1)[0]
        self.assertLess(revised.index('| Idle |'), revised.index('| Emotes |'))
        self.assertLess(revised.index('| Emotes |'), revised.index('| Sitting |'))
        self.assertNotIn('](content/images/animations/idle.gif)', page)
        self.assertIn('**Unverified**', page)
        self.assertIn('noExport', page)

    def test_catalog_page_and_credited_images_are_retained_without_raw_fixtures(self):
        page = (ROOT / 'docs/animations.md').read_text()
        self.assertIn('NESW', page)
        self.assertIn('`walk`', page)
        self.assertIn('64×64', page)
        self.assertIn('animations.json', page)
        self.assertIn('[[animation-reference|', page)
        data = (ROOT / 'docs/images/animations/catalog/walk.gif').read_bytes()
        self.assertIn(data[:6], (b'GIF89a', b'GIF87a'))
        self.assertEqual(struct.unpack('<HH', data[6:10]), (64, 64))
        for record in self.manifest['provenance']:
            data = (ROOT / 'docs/images/animations/catalog' / record['filename']).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), record['sha256'])

    def test_default_aseprite_discovers_macos_bundle_without_path_entry(self):
        with patch.object(builder.shutil, 'which', return_value=None), \
                patch.object(builder.Path, 'is_file', return_value=True), \
                patch.object(builder.os, 'access', return_value=True):
            self.assertEqual(builder.resolve_aseprite('aseprite', platform='darwin'),
                             '/Applications/Aseprite.app/Contents/MacOS/aseprite')

    def test_aseprite_path_wins_and_bad_explicit_override_is_not_hidden(self):
        with patch.object(builder.shutil, 'which', return_value='/opt/bin/aseprite'):
            self.assertEqual(builder.resolve_aseprite('aseprite', platform='darwin'), '/opt/bin/aseprite')
        with patch.object(builder.shutil, 'which', return_value=None):
            with self.assertRaisesRegex(ValueError, 'ASEPRITE'):
                builder.resolve_aseprite('/missing/custom-aseprite', platform='darwin')
            with self.assertRaisesRegex(ValueError, 'ASEPRITE'):
                builder.resolve_aseprite('aseprite', platform='linux')

    def test_poses_are_individual_columns_not_database_animations(self):
        self.assertEqual(len(self.manifest['poses']), 7)
        self.assertEqual({p['sheet'] for p in self.manifest['poses']}, {'emotes', 'sitting'})
        for sheet in self.manifest['pose_sheets']:
            self.assertNotIn('preview_sequence', sheet)
            self.assertEqual([p['column'] for p in self.manifest['poses'] if p['sheet'] == sheet['id']],
                             list(range(sheet['frames'])))
        ids = {row[0] for row in self.database().execute('SELECT id FROM animations')}
        self.assertTrue(ids.isdisjoint({'emotes', 'sitting'} | {p['id'] for p in self.manifest['poses']}))
        invalid = copy.deepcopy(self.manifest)
        invalid['poses'][0]['column'] = 999
        path = self.root / 'bad-pose.json'
        path.write_text(json.dumps(invalid))
        with self.assertRaisesRegex(ValueError, 'Pose column'):
            builder.load_animation_manifest(path)

    def test_invalid_manifest_is_not_accepted(self):
        cases = []
        for key, value in [('preview_direction', 'missing'), ('preview_sequence', [999]),
                           ('preview_duration_ms', [0]), ('directions', []), ('id', '../escape')]:
            manifest = copy.deepcopy(self.manifest)
            manifest['animations'][0][key] = value
            cases.append(manifest)
        duplicate = copy.deepcopy(self.manifest)
        duplicate['animations'].append(duplicate['animations'][0])
        cases.append(duplicate)
        for manifest in cases:
            path = self.root / 'manifest.json'
            path.write_text(json.dumps(manifest))
            with self.subTest(manifest=manifest['animations'][0]['id']), self.assertRaises(ValueError):
                builder.load_animation_manifest(path)

    def test_missing_catalog_preserves_previous_database_and_docs(self):
        output, docs = self.root / 'catalog.sqlite', self.root / 'animations.md'
        builder.build_database(ROOT / 'scripts/catalog.sql', output)
        original = output.read_bytes()
        docs.write_text('previous docs')
        with self.assertRaises((ValueError, FileNotFoundError)):
            builder.build_database(ROOT / 'scripts/catalog.sql', output,
                                   catalog_root=self.root / 'absent', animation_docs=docs)
        self.assertEqual(output.read_bytes(), original)
        self.assertEqual(docs.read_text(), 'previous docs')
        self.assertEqual(list(self.root.glob('.database-*')), [])

    def test_renderer_failure_preserves_previous_outputs(self):
        output, docs = self.root / 'catalog.sqlite', self.root / 'animations.md'
        builder.build_database(ROOT / 'scripts/catalog.sql', output)
        original = output.read_bytes()
        docs.write_text('previous docs')
        with patch('catalog_import.import_catalog', return_value={'animations': [], 'items': []}), \
                patch.object(builder, 'stage_catalog_docs', side_effect=subprocess.CalledProcessError(1, ['aseprite'])):
            with self.assertRaises(subprocess.CalledProcessError):
                builder.build_database(ROOT / 'scripts/catalog.sql', output,
                                       catalog_root=self.root / 'catalog', animation_docs=docs)
        self.assertEqual(output.read_bytes(), original)
        self.assertEqual(docs.read_text(), 'previous docs')
        self.assertEqual(list(self.root.glob('.database-*')), [])


if __name__ == '__main__':
    unittest.main()
