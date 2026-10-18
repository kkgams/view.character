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
        connection.executescript((ROOT / 'scripts/catalog.sql').read_text())
        builder.seed_animations(connection, self.manifest)
        return connection

    def test_complete_verified_inventory_and_layout_exception(self):
        self.assertEqual(len(self.manifest['animations']), 12)
        self.assertEqual({entry['id'] for entry in self.manifest['animations']}, {
            'climb', 'combat_1h_backslash', 'combat_1h_halfslash', 'combat_1h_idle',
            'combat_1h_slash', 'emotes', 'idle', 'jump', 'legacy_swing', 'run', 'sitting', 'walk'})
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
        self.assertIn('| ID | Name | Image |', page)
        self.assertIn('Rest &#124; &lt;&amp;&gt;', page)
        self.assertEqual(page.count('](content/images/animations/') - 2, 12)  # previews, credits, license
        connection.execute("INSERT INTO animations VALUES ('unknown', 'Unknown')")
        with self.assertRaisesRegex(ValueError, 'IDs do not match'):
            builder.animation_markdown(connection, self.manifest)

    def test_generated_page_and_images_are_retained_without_raw_fixtures(self):
        page = (ROOT / 'docs/animations.md').read_text()
        self.assertEqual(page, builder.animation_markdown(self.database(), self.manifest))
        for entry in self.manifest['animations']:
            data = (ROOT / 'docs/images/animations' / (entry['id'] + '.gif')).read_bytes()
            self.assertIn(data[:6], (b'GIF89a', b'GIF87a'))
            self.assertEqual(struct.unpack('<HH', data[6:10]), (64, 64))
        for record in self.manifest['provenance']:
            data = (ROOT / 'docs/images/animations' / record['filename']).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), record['sha256'])

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

    def test_missing_fixtures_preserve_previous_database_and_docs(self):
        output, docs = self.root / 'catalog.sqlite', self.root / 'animations.md'
        builder.build_database(ROOT / 'scripts/catalog.sql', output)
        original = output.read_bytes()
        docs.write_text('previous docs')
        with self.assertRaisesRegex(ValueError, 'make animation-fixtures'):
            builder.build_database(ROOT / 'scripts/catalog.sql', output,
                                   animation_fixtures=self.root / 'absent', animation_docs=docs)
        self.assertEqual(output.read_bytes(), original)
        self.assertEqual(docs.read_text(), 'previous docs')
        self.assertEqual(list(self.root.glob('.database-*')), [])

    def test_renderer_failure_preserves_previous_outputs(self):
        output, docs = self.root / 'catalog.sqlite', self.root / 'animations.md'
        builder.build_database(ROOT / 'scripts/catalog.sql', output)
        original = output.read_bytes()
        docs.write_text('previous docs')
        with patch.object(builder, 'validate_animation_fixtures'), patch.object(builder.subprocess, 'run',
                side_effect=subprocess.CalledProcessError(1, ['aseprite'])):
            with self.assertRaises(subprocess.CalledProcessError):
                builder.build_database(ROOT / 'scripts/catalog.sql', output,
                                       animation_fixtures=self.root, animation_docs=docs)
        self.assertEqual(output.read_bytes(), original)
        self.assertEqual(docs.read_text(), 'previous docs')
        self.assertEqual(list(self.root.glob('.database-*')), [])


if __name__ == '__main__':
    unittest.main()
