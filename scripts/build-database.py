"""Build a fresh SQLite catalog from the complete SQL snapshot (no migrations)."""

import argparse
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def build_database(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output:
        raise ValueError("Database output must not overwrite the SQL source")
    sql = source.read_text(encoding="utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Build beside the destination so replacement is atomic, even across mounts.
    # Errors leave the previous database untouched and clean up all temporary files.
    with tempfile.TemporaryDirectory(prefix=".database-", dir=output.parent) as directory:
        temporary = Path(directory) / "db.sqlite"
        with closing(sqlite3.connect(temporary)) as connection:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.executescript(sql)
            if connection.in_transaction:
                raise ValueError("SQL snapshot must not leave an open transaction")
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise ValueError("SQL snapshot contains broken foreign-key references")
            if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise ValueError("Generated database failed SQLite integrity check")
        os.replace(temporary, output)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "scripts/catalog.sql")
    parser.add_argument("--output", type=Path, default=ROOT / "db.sqlite")
    args = parser.parse_args()
    print(f"Built {build_database(args.source, args.output)}")


if __name__ == "__main__":
    main()
