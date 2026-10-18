"""Isolated local Git fixtures; no network, project commits or large upstream clone."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture_repositories', ROOT / 'scripts/fetch_fixture_repositories.py')
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class FixtureRepositoryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.upstream = self.root / 'upstream'
        fixtures.git('init', '-q', self.upstream)
        fixtures.git('-C', self.upstream, 'config', 'user.name', 'Fixture Test')
        fixtures.git('-C', self.upstream, 'config', 'user.email', 'fixture@example.invalid')
        self.commit('original')
        self.record = {'id': 'local-test', 'mode': 'clone', 'url': self.upstream.as_uri(),
                       'revision': fixtures.git('-C', self.upstream, 'rev-parse', 'HEAD'),
                       'directory': 'fixtures/repos/local-test'}
        self.destination = self.root / self.record['directory']

    def commit(self, text):
        (self.upstream / 'README.md').write_text(text)
        fixtures.git('-C', self.upstream, 'add', 'README.md')
        fixtures.git('-C', self.upstream, '-c', 'commit.gpgsign=false', 'commit', '-qm',
                     '🧪(fixture-test): seed isolated upstream')

    def test_clone_exact_old_pin_and_repeated_offline_check(self):
        self.commit('newer upstream HEAD')
        fixtures.prepare(self.record, root=self.root)
        self.assertEqual((self.destination / 'README.md').read_text(), 'original')
        self.assertEqual(fixtures.git('-C', self.destination, 'rev-parse', 'HEAD'), self.record['revision'])
        fixtures.prepare(self.record, root=self.root, check_only=True)

    def test_existing_changes_are_not_reset_or_overwritten(self):
        fixtures.prepare(self.record, root=self.root)
        path = self.destination / 'README.md'
        path.write_text('local experiment')
        with self.assertRaisesRegex(ValueError, 'Modified fixture'):
            fixtures.prepare(self.record, root=self.root)
        self.assertEqual(path.read_text(), 'local experiment')

    def test_wrong_origin_and_missing_checkout_fail_explicitly(self):
        with self.assertRaisesRegex(ValueError, 'Missing'):
            fixtures.prepare(self.record, root=self.root, check_only=True)
        self.assertFalse(self.destination.exists())
        fixtures.prepare(self.record, root=self.root)
        fixtures.git('-C', self.destination, 'remote', 'set-url', 'origin', 'https://example.invalid/unrelated.git')
        with self.assertRaisesRegex(ValueError, 'Unexpected origin'):
            fixtures.prepare(self.record, root=self.root)

    def test_download_source_registry_is_pinned_and_documents_modes(self):
        manifest = json.loads(fixtures.MANIFEST.read_text())
        self.assertEqual(len(manifest['repositories']), len({r['id'] for r in manifest['repositories']}))
        for record in manifest['repositories']:
            self.assertRegex(record['revision'], r'^[0-9a-f]{40}$')
            self.assertTrue(record['source_manifests'])
            self.assertIn(record['mode'], ['clone', 'selected-files'])
            for source in record['source_manifests']:
                self.assertTrue((ROOT / source).is_file())


if __name__ == '__main__':
    unittest.main()
