"""Fixture-free motion manifest and safe restoration tests."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('character_motions', ROOT / 'scripts/prepare-character-motions.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


def header(width=192, height=256):
    # Synthetic header for unit tests only, never development artwork.
    return b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR' + struct.pack('>II', width, height) + b'\x08\x06\x00\x00\x00' + b'\x00' * 4


class MotionTests(unittest.TestCase):
    def setUp(self):
        self.manifest, self.fixtures, self.motions = [json.loads((ROOT / 'scripts' / name).read_text()) for name in ('lpc-motion-fixtures.json', 'lpc-fixtures.json', 'lpc-animations.json')]

    def validate(self):
        M.validate(self.manifest, self.fixtures, self.motions)

    def test_real_manifest(self):
        self.validate()
        self.assertEqual(len(self.manifest['items']), 20)
        records = [r for i in self.manifest['items'] for r in i['sheets'].values()]
        self.assertEqual(sum(r['status'] == 'present' for r in records), 221)
        self.assertEqual(sum(r['status'] == 'absent' for r in records), 19)
        self.assertEqual(sum('frame_count_variance' in r for r in records), 18)
        self.assertEqual(sum('source_row_contract' in r for r in records), 2)

    def test_malformed_manifest(self):
        mutations = [lambda: self.manifest.update(revision='bad'),
                     lambda: self.manifest['items'][0].update(id='../escape'),
                     lambda: self.manifest['items'][0].update(license='CC0'),
                     lambda: self.manifest['items'][0]['sheets'].pop('idle'),
                     lambda: self.manifest['items'][0]['sheets']['idle'].update(sha256='bad'),
                     lambda: self.manifest['items'][0]['sheets']['idle'].update(directions=['south']),
                     lambda: self.manifest['items'][2]['sheets']['emotes'].pop('frame_count_variance'),
                     lambda: self.manifest['items'][12]['sheets']['climb'].pop('source_row_contract'),
                     lambda: self.motions['poses'][0].update(column=999),
                     lambda: self.motions['animations'][0].update(preview_duration_ms=[])]
        for mutation in mutations:
            self.setUp()
            mutation()
            with self.assertRaises((ValueError, KeyError)): self.validate()

    def test_safe_restore_reuse_and_mismatch(self):
        data = header()
        digest = hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = root / 'original.png', root / 'motions/idle.png'
            source.write_bytes(data)
            def forbidden(url): self.fail('Must reuse verified local source')
            self.assertEqual(M.obtain(target, 'unused', digest, source, (192, 256), forbidden), data)
            target.write_bytes(b'experiment')
            with self.assertRaises(ValueError): M.obtain(target, 'unused', digest, fetch=forbidden)
            self.assertEqual(target.read_bytes(), b'experiment')
            target.unlink()
            with self.assertRaises(ValueError): M.obtain(target, 'unused', digest, dimensions=(64, 64), fetch=lambda _: data)
            self.assertFalse(target.exists())
            with self.assertRaises(ValueError): M.obtain(target, 'unused', '0' * 64, fetch=lambda _: data)
            self.assertFalse(target.exists())
            M.obtain(target, 'unused', digest, dimensions=(192, 256), fetch=lambda _: data)
            self.assertEqual(target.read_bytes(), data)

    def test_bad_png_and_network_failure(self):
        for data in [b'', b'not png', header()[:24]]:
            with self.assertRaises(ValueError): M.geometry(data)
        with tempfile.TemporaryDirectory() as directory:
            def fail(url): raise OSError('network failure')
            with self.assertRaises(OSError): M.obtain(Path(directory) / 'new.png', 'url', '0' * 64, fetch=fail)

    def test_catalog_actual_geometry_and_atomic_failure(self):
        payloads = {}
        for item in self.manifest['items']:
            for record in item['sheets'].values():
                if record['status'] == 'present':
                    data = header(record['width'], record['height'])
                    record['sha256'] = hashlib.sha256(data).hexdigest()
                    payloads[record['source_path']] = data
        for item in self.fixtures['items']:
            corresponding = next(i for i in self.manifest['items'] if i['id'] == item['id'])
            item['sha256'] = corresponding['sha256'] = corresponding['sheets']['idle']['sha256']
        for sheet in self.motions['animations'] + self.motions['pose_sheets']:
            for role in ('body', 'head'):
                item = next(i for i in self.manifest['items'] if i['id'] == role)
                sheet[role]['sha256'] = item['sheets'][sheet['id']]['sha256']
        self.manifest['provenance'] = self.fixtures['provenance'] = []
        def fetch(url): return payloads[unquote(url.split(self.manifest['revision'] + '/', 1)[1])]
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            root = Path(directory)
            catalog = M.prepare(root, self.manifest, self.fixtures, self.motions, fetch)
            self.assertEqual(set(catalog), {'frame_size', 'animations', 'pose_sheets', 'poses', 'items'})
            self.assertEqual(catalog['animations'][0]['directions'], ['north'])
            items = {item['id']: item['sheets'] for item in catalog['items']}
            self.assertEqual(items['hair-parted']['emotes']['frames'], 3)
            self.assertNotIn('climb', items['beard-trimmed'])
            self.assertEqual(items['helm-norman']['climb']['directions'], M.DIRECTIONS)
            self.assertEqual(base64.b64decode(items['head']['idle']['sheet_base64']), header())
            self.assertEqual(json.loads((root / 'motion-catalog.json').read_text()), catalog)
            previous = (root / 'motion-catalog.json').read_bytes()
            (root / 'motions/body/idle_10.png').write_bytes(b'experiment')
            with self.assertRaises(ValueError): M.prepare(root, self.manifest, self.fixtures, self.motions, fetch)
            self.assertEqual((root / 'motion-catalog.json').read_bytes(), previous)


if __name__ == '__main__':
    unittest.main()
