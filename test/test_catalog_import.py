"""Fixture-independent normalized catalog importer tests."""
import json
import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import unittest
import zlib

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from catalog_images import write_indexed
from catalog_import import import_catalog, load_animations

PALETTE = [(17, 23, 42, 0), (100, 20, 50, 255), (0, 255, 0, 255)]
MASK = [(0, 0, 0, 255), (255, 255, 255, 255)]
GPL = "GIMP Palette\r\nName: Hair Colors\r\nColumns: 2\r\n# Keep this comment\r\n100 20 50  Warm Shade\r\n0 255 0  Accent\r\n"


class CatalogImportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "catalog"
        self.root.mkdir()
        (self.root / "palettes").mkdir()
        (self.root / "palettes/hair.gpl").write_bytes(GPL.encode("utf-8"))
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript((SCRIPTS / "catalog.sql").read_text())
        self.slots = [{"id": "hair", "name": "Hair", "icon": "hair-strands", "order": 0}]
        self.animations = [{"id": "combat_idle_long", "name": "Combat idle", "frame_width": 2,
                            "frame_height": 3, "frame_count": 2, "directions": "NESW",
                            "sequence": [0, 1, 0], "durations_ms": [100, 20, 100],
                            "timing_note": "Explicit test timing"}]
        self.write_json(self.root / "slots.json", self.slots)
        self.write_json(self.root / "animations.json", self.animations)
        self.folder = self.root / "items" / "hair" / "long-hair"
        self.folder.mkdir(parents=True)
        self.write_json(self.folder / "data.json", {"name": "Long hair", "palette": "hair"})
        self.icon = self.folder / "icon.png"
        self.drawing = self.folder / "combat_idle_long_120.png"
        self.mask = self.folder / "combat_idle_long_100m.png"
        self.png(self.icon, 32, 32)
        self.png(self.drawing)
        self.png(self.mask, palette=MASK)

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value), encoding="utf-8")

    @staticmethod
    def png(path, width=4, height=12, palette=PALETTE):
        write_indexed(path, width, height,
                      bytes(i % len(palette) for i in range(width * height)), palette)

    def reject(self, path, text=None):
        before = self.connection.execute("SELECT * FROM slots").fetchall()
        with self.assertRaises(ValueError) as caught:
            import_catalog(self.connection, self.root)
        self.assertIn(str(path), str(caught.exception))
        if text:
            self.assertIn(text, str(caught.exception))
        self.assertEqual(self.connection.execute("SELECT * FROM slots").fetchall(), before)
        self.assertEqual(self.connection.execute("SELECT count(*) FROM items").fetchone()[0], 0)

    def test_exact_bytes_refs_palette_and_nested_underscore_animation(self):
        result = import_catalog(self.connection, self.root)
        self.assertEqual(result["animations"], self.animations)
        item = result["items"][0]
        self.assertEqual((item["id"], item["name"], item["slot"], item["icon"]),
                         ("hair/long-hair", "Long hair", "hair", self.icon))
        self.assertEqual(item["components"], [
            {"path": self.mask, "animation": "combat_idle_long", "layer": 100, "mask": 1},
            {"path": self.drawing, "animation": "combat_idle_long", "layer": 120, "mask": 0}])
        self.assertEqual(self.connection.execute('SELECT id,name,icon,"order" FROM slots').fetchall(),
                         [("hair", "Hair", "hair-strands", 0)])
        self.assertEqual(self.connection.execute("SELECT id,name,slot,icon,palette FROM items").fetchone(),
                         ("hair/long-hair", "Long hair", "hair", self.icon.read_bytes(), "hair"))
        palette = self.connection.execute("SELECT id,name,data FROM palettes").fetchone()
        self.assertEqual(palette, ("hair", "Hair Colors", GPL))
        self.assertEqual(self.connection.execute("SELECT id,item,animation,layer,mask,data FROM sprites ORDER BY id").fetchall(), [
            ("hair/long-hair/combat_idle_long_100m", "hair/long-hair", "combat_idle_long", 100, 1, self.mask.read_bytes()),
            ("hair/long-hair/combat_idle_long_120", "hair/long-hair", "combat_idle_long", 120, 0, self.drawing.read_bytes())])
        animation = self.connection.execute("SELECT * FROM animations").fetchone()
        self.assertEqual(animation[:6], ("combat_idle_long", "Combat idle", 2, 3, 2, "NESW"))
        self.assertEqual(json.loads(animation[6]), [0, 1, 0])
        self.assertEqual(json.loads(animation[7]), [100, 20, 100])
        self.assertEqual(self.connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_builder_round_trip_and_invalid_import_preserves_previous_database(self):
        spec = importlib.util.spec_from_file_location('catalog_builder', SCRIPTS / 'build-database.py')
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        output = self.root.parent / 'catalog.sqlite'
        builder.build_database(SCRIPTS / 'catalog.sql', output, catalog_root=self.root)
        with closing(sqlite3.connect(output)) as connection:
            self.assertEqual(connection.execute('SELECT id FROM items').fetchall(), [('hair/long-hair',)])
            self.assertEqual(connection.execute('SELECT directions FROM animations').fetchall(), [('NESW',)])
            self.assertEqual(connection.execute('SELECT data FROM sprites WHERE mask=0').fetchone()[0], self.drawing.read_bytes())
            self.assertEqual(connection.execute('PRAGMA integrity_check').fetchall(), [('ok',)])
        original = output.read_bytes()
        self.animations[0]['directions'] = 'NWSE'
        self.write_json(self.root / 'animations.json', self.animations)
        with self.assertRaisesRegex(ValueError, 'NESW'):
            builder.build_database(SCRIPTS / 'catalog.sql', output, catalog_root=self.root)
        self.assertEqual(output.read_bytes(), original)
        self.assertEqual(list(self.root.parent.glob('.database-*')), [])

    def test_builder_outputs_cannot_overwrite_catalog_inputs(self):
        spec = importlib.util.spec_from_file_location('catalog_builder', SCRIPTS / 'build-database.py')
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        before = self.icon.read_bytes()
        with self.assertRaisesRegex(ValueError, 'catalog inputs'):
            builder.build_database(SCRIPTS / 'catalog.sql', self.icon, catalog_root=self.root)
        self.assertEqual(self.icon.read_bytes(), before)

    def test_shared_named_palette_is_inserted_once(self):
        duplicate = self.folder.with_name('short-hair')
        duplicate.mkdir()
        for path in self.folder.iterdir():
            (duplicate / path.name).write_bytes(path.read_bytes())
        import_catalog(self.connection, self.root)
        self.assertEqual(self.connection.execute('SELECT id,name,data FROM palettes').fetchall(), [('hair', 'Hair Colors', GPL)])
        self.assertEqual(self.connection.execute('SELECT palette FROM items').fetchall(), [('hair',), ('hair',)])

    def test_missing_or_invalid_palette_reference(self):
        path = self.folder / 'data.json'
        for data in ({'name': 'Hair'}, {'name': 'Hair', 'palette': 'missing'},
                     {'name': 'Hair', 'palette': '../hair'}, {'name': 'Hair', 'palette': 'hair.gpl'}):
            with self.subTest(data=data):
                self.write_json(path, data)
                self.reject(path)

    def test_gpl_order_must_match_png_without_remapping(self):
        path = self.root / 'palettes/hair.gpl'
        before = self.icon.read_bytes()
        path.write_text('GIMP Palette\nName: Hair Colors\n0 255 0 Accent\n100 20 50 Warm Shade\n')
        self.reject(self.icon, 'file order')
        self.assertEqual(self.icon.read_bytes(), before)

    def test_missing_invalid_or_symlinked_palette_files(self):
        path = self.root / 'palettes/hair.gpl'
        for text in ('not GPL', 'GIMP Palette\nName: Missing colors\n'):
            path.write_text(text)
            self.reject(path)
        path.unlink()
        self.reject(self.folder / 'data.json', 'unknown palette')
        path.symlink_to(self.icon)
        self.reject(path, 'symlinks')
        path.unlink()
        path.parent.rmdir()
        self.reject(path.parent)

    def test_unknown_palette_files_are_rejected(self):
        path = self.root / 'palettes/unexpected.txt'
        path.write_text(GPL)
        self.reject(path, '.gpl')

    def test_multiple_layers_and_optional_provenance(self):
        self.png(self.folder / "combat_idle_long_9.png")
        (self.root / "README.md").write_text("Catalog provenance")
        provenance = self.root / "provenance" / "licenses"
        provenance.mkdir(parents=True)
        (provenance / "LICENSE.txt").write_text("Synthetic test data")
        self.assertEqual(len(import_catalog(self.connection, self.root)["items"][0]["components"]), 3)

    def test_invalid_filenames(self):
        for name in ("walk.png", "combat_idle_long_0120.png", "combat_idle_long_120M.png",
                     "combat_idle_long_7.png", "unknown_120.png", "combat_idle_long_m.png"):
            with self.subTest(name=name):
                path = self.folder / name
                self.png(path)
                self.reject(path)
                path.unlink()

    def test_item_directories_are_required_under_items(self):
        items = self.root / 'items'
        (items / 'hair').rename(self.root / 'hair')
        self.reject(self.root / 'hair', 'unknown catalog entry')
        items.rmdir()
        self.reject(items, 'expected directory')

    def test_unknown_files_and_nested_directories(self):
        for parent in (self.root, self.root / "items", self.root / "items" / "hair", self.folder):
            with self.subTest(parent=parent):
                path = parent / "unexpected.txt"
                path.write_text("unexpected")
                self.reject(path)
                path.unlink()
        nested = self.folder / "nested"
        nested.mkdir()
        self.reject(nested)

    def test_symlinks(self):
        for path in (self.root / "unexpected", self.folder / "extra.png", self.root / "provenance"):
            with self.subTest(path=path):
                path.symlink_to(self.icon)
                self.reject(path)
                path.unlink()
        self.drawing.unlink()
        self.drawing.symlink_to(self.icon)
        self.reject(self.drawing)

    def test_duplicate_json_fields(self):
        path = self.folder / "data.json"
        path.write_text('{"name":"First","name":"Second"}')
        self.reject(path, "duplicate JSON field")

    def test_invalid_item_slug(self):
        renamed = self.folder.with_name("Bad item")
        self.folder.rename(renamed)
        self.reject(renamed, "invalid ID")

    def test_required_item_metadata(self):
        path = self.folder / "data.json"
        for value in ({}, {"name": ""}, {"name": "Hair", "layer": 120}, []):
            with self.subTest(value=value):
                self.write_json(path, value)
                self.reject(path)
        path.unlink()
        self.reject(path)

    def test_no_components_or_mask_only(self):
        self.drawing.unlink()
        self.reject(self.folder, "drawing component")
        self.mask.unlink()
        self.reject(self.folder, "drawing component")

    def test_full_shared_palette(self):
        for palette in (PALETTE[:2], [PALETTE[0], PALETTE[2], PALETTE[1]],
                        [*PALETTE, (1, 2, 3, 255)]):
            with self.subTest(palette=palette):
                self.png(self.drawing, palette=palette)
                self.reject(self.drawing, "full palette")

    def test_palette_alpha_policy(self):
        for palette in ([(0, 0, 0, 255), *PALETTE[1:]],
                        [PALETTE[0], (100, 20, 50, 0), PALETTE[2]],
                        [PALETTE[0], (100, 20, 50, 128), PALETTE[2]]):
            with self.subTest(palette=palette):
                self.png(self.icon, 32, 32, palette)
                self.reject(self.icon, "transparent")

    def test_binary_mask_palette(self):
        for palette in (list(reversed(MASK)), [MASK[0], (255, 255, 255, 0)],
                        [*MASK, (10, 10, 10, 255)], PALETTE):
            with self.subTest(palette=palette):
                self.png(self.mask, palette=palette)
                self.reject(self.mask, "mask palette")

    def test_geometry(self):
        for path, width, height in ((self.icon, 31, 32), (self.drawing, 2, 12), (self.mask, 4, 9)):
            with self.subTest(path=path):
                original = path.read_bytes()
                self.png(path, width, height, MASK if path == self.mask else PALETTE)
                self.reject(path, "geometry")
                path.write_bytes(original)

    def test_rgba_is_not_indexed(self):
        def chunk(kind, payload):
            return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
        self.icon.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 32, 8, 6, 0, 0, 0))
                              + chunk(b"IDAT", zlib.compress((b"\0" + b"\0" * 128) * 32)) + chunk(b"IEND", b""))
        self.reject(self.icon, "indexed")

    def test_missing_and_malformed_root_metadata(self):
        for name in ("slots.json", "animations.json"):
            with self.subTest(name=name):
                path = self.root / name
                original = path.read_bytes()
                path.unlink()
                self.reject(path)
                path.write_text("{")
                self.reject(path, "JSON")
                path.write_bytes(original)

    def test_invalid_slot_metadata(self):
        path = self.root / "slots.json"
        for patch in ({"id": "../hair"}, {"id": "provenance"}, {"id": "palettes"}, {"name": ""}, {"icon": ""}, {"order": True},
                      {"order": -1}, {"extra": "unknown"}):
            with self.subTest(patch=patch):
                self.write_json(path, [{**self.slots[0], **patch}])
                self.reject(path)
        self.write_json(path, self.slots * 2)
        self.reject(path, "duplicate ID")
        self.write_json(path, [self.slots[0], {**self.slots[0], "id": "head"}])
        self.reject(path, "duplicate slot order")

    def test_animation_validation(self):
        path = self.root / "animations.json"
        variants = [{"id": "../idle"}, {"name": ""}, {"frame_width": True}, {"frame_height": 0},
                    {"frame_count": -1}, {"directions": "NWSE"}, {"sequence": []}, {"sequence": [2]},
                    {"sequence": [False]}, {"sequence": [0.0]}, {"durations_ms": [100]},
                    {"durations_ms": [100, 25, 100]}, {"durations_ms": [0, 10, 10]},
                    {"durations_ms": [True, 10, 10]}, {"timing_note": 5}, {"extra": "unknown"}]
        for patch in variants:
            with self.subTest(patch=patch):
                self.write_json(path, [{**self.animations[0], **patch}])
                with self.assertRaisesRegex(ValueError, str(path)):
                    load_animations(path)
        for field in self.animations[0]:
            if field != "timing_note":
                with self.subTest(missing=field):
                    value = dict(self.animations[0])
                    del value[field]
                    self.write_json(path, [value])
                    self.reject(path)
        self.write_json(path, self.animations * 2)
        self.reject(path, "duplicate ID")

    def test_optional_timing_note(self):
        del self.animations[0]["timing_note"]
        self.write_json(self.root / "animations.json", self.animations)
        self.assertEqual(load_animations(self.root / "animations.json"), self.animations)

    def test_existing_data_rejected(self):
        self.connection.execute("INSERT INTO palettes (id,name,data) VALUES ('existing','Existing','GPL source')")
        self.reject(self.root, "palettes must be empty")

    def test_sql_failure_rolls_back(self):
        before = self.connection.execute("SELECT * FROM slots").fetchall()
        self.connection.execute("CREATE TRIGGER reject_sprite BEFORE INSERT ON sprites BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            import_catalog(self.connection, self.root)
        self.assertEqual(self.connection.execute("SELECT * FROM slots").fetchall(), before)
        for table in ("items", "sprites", "palettes", "animations"):
            self.assertEqual(self.connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
