import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_database", ROOT / "scripts/build-database.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source.sql"
        self.output = self.root / "catalog.sqlite"

    def rows(self, query):
        connection = sqlite3.connect(self.output)
        try:
            return connection.execute(query).fetchall()
        finally:
            connection.close()

    def test_real_snapshot_builds_all_tables_and_seeds(self):
        builder.build_database(ROOT / "scripts/catalog.sql", self.output)
        self.assertEqual(self.rows("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"),
                         [(name,) for name in ("animations", "items", "palettes", "slots", "sprites")])
        self.assertEqual(self.rows("SELECT count(*) FROM slots"), [(10,)])
        self.assertEqual(self.rows("SELECT name FROM sqlite_schema WHERE name=\'layers\'"), [])
        self.assertEqual(self.rows("PRAGMA foreign_key_check"), [])
        self.assertEqual(self.rows("PRAGMA integrity_check"), [("ok",)])

    def test_rebuild_replaces_the_whole_database(self):
        self.source.write_text("CREATE TABLE old (id INTEGER); INSERT INTO old VALUES (1);")
        builder.build_database(self.source, self.output, animation_manifest=None)
        self.source.write_text("CREATE TABLE fresh (id INTEGER); INSERT INTO fresh VALUES (2);")
        builder.build_database(self.source, self.output, animation_manifest=None)
        self.assertEqual(self.rows("SELECT id FROM fresh"), [(2,)])
        self.assertEqual(self.rows("SELECT name FROM sqlite_schema WHERE name='old'"), [])
        self.assertEqual(list(self.root.glob(".database-*")), [])

    def test_failures_preserve_existing_output_and_remove_staging(self):
        self.source.write_text("CREATE TABLE keep (id INTEGER);")
        builder.build_database(self.source, self.output, animation_manifest=None)
        original = self.output.read_bytes()
        for sql in (
            "CREATE TABLE partial (id INTEGER); INSERT INTO missing VALUES (1);",
            "PRAGMA foreign_keys=OFF; CREATE TABLE child (id REFERENCES missing(id)); INSERT INTO child VALUES (1);",
            "BEGIN; CREATE TABLE uncommitted (id INTEGER);",
        ):
            with self.subTest(sql=sql):
                self.source.write_text(sql)
                with self.assertRaises((sqlite3.Error, ValueError)):
                    builder.build_database(self.source, self.output, animation_manifest=None)
                self.assertEqual(self.output.read_bytes(), original)
                self.assertEqual(list(self.root.glob(".database-*")), [])

    def test_failure_does_not_publish_a_partial_first_build(self):
        self.source.write_text("CREATE TABLE partial (id INTEGER); INVALID SQL;")
        with self.assertRaises(sqlite3.Error):
            builder.build_database(self.source, self.output, animation_manifest=None)
        self.assertFalse(self.output.exists())

    def test_output_cannot_overwrite_source(self):
        self.source.write_text("SELECT 1;")
        with self.assertRaises(ValueError):
            builder.build_database(self.source, self.source, animation_manifest=None)
        self.assertEqual(self.source.read_text(), "SELECT 1;")


if __name__ == "__main__":
    unittest.main()
