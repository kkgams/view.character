# view.character instructions

Follow the workspace rules and protected `../gams/docs/gams-view-development-guide.md`.
This directory is an independent Git repository. Keep its history and releases
separate from sibling repositories and the workspace root. Local `fixtures/`,
installed Units and the entire `tools/` directory are intentionally ignored.
Keep maintained development/check scripts in tracked `scripts/`; reserve
`tools/` for local/downloaded tool artifacts.

## Ahead-of-time database build

`make database` runs `scripts/build-database.py` to create ignored `db.sqlite`
from `scripts/catalog.sql`; `DATABASE=other.sqlite` overrides the output (also
update `gams.json`). It builds afresh, checks foreign keys/integrity, and atomically
replaces the file only on success. No migration registry or versioning.
`gams.json` opens `db.sqlite` through the ordinary shared Host SQL connection.
Close the Project/preview before rebuilding and reopen it afterward: an open
connection does not follow atomic file replacement.

## Pre-alpha catalog SQL

SQL is build-time input only. Initial mount and View reload/Reset query the
existing database and reset only the transient character session. Never replay
SQL, drop tables or rebuild the database from a View. Manual database edits and
debug tables must survive reload/Reset. The baseline seeds slots and animation
names; there is no layers table. Editor slots, names and icons come from
`slots ORDER BY "order"`, arranged left/right pairs then top/down. Do not reintroduce a JS
slot metadata registry or fixed LEFT/RIGHT lists as the source of truth.
`items`, `palettes` and `sprites` remain empty, with foreign keys, JSON-array
palette data, BLOB image storage and a checked 0/1 mask flag. `animations` is a
seeded name registry, queried on reload for the side-panel select beside Play.
Only the existing Idle fixture is playable; other selections are explicit
placeholders until sprite data is connected. Do not play Idle while labeling it
as a different database animation. Artwork/palettes still use fixture mocks.
`docs/layers.md` defines fixed numeric layers (ID = paint order), mirrored in the
renderer and checked by tests. Fixture items carry explicit layers; never infer
a default layer from a slot. Future fixture filenames must include the numeric
layer and optional mask suffix. `sprites.layer` is required, without a foreign
key to a registry. Competing equipped items on a drawing layer are an error;
masks target that layer without claiming occupancy. Binary mask raster playback
and the folder importer are not implemented yet. Do not invent additional schema
as loader plumbing or assume one slot equals one render layer.
Use the shared Host `/util/sql.js` connection so debug `view.sql` sees the same
database. Runtime must not create schema or silently recover a missing catalog.

## Explicit user-approved View CSS exception

The user approved View-specific CSS **inside this View's shadow DOM only**, for
now, to size the equipment/inventory cells and control the character preview
viewport instead of drawing the equipment/inventory UI on canvas.

The approval is limited to `APPROVED_LAYOUT_CSS` in `src/views/view-character.js`: fixed 64×64 slot
cells, fixed outer equipment columns, a flexible central preview with scrolling
at oversized zoom, and inventory table width determined by its slot columns.
A subsequent explicit user approval adds **32px centered empty-slot and inventory
remove icons only**; equipped sprites and toolbar icons retain their shared sizing.
The user also approved **three square inventory cells per row**, using explicit
64px dimensions. The ineffective `aspect-ratio` rule was removed at the user's
request. This remains View-local, not a shared sizing contract.
The shadow root still loads canonical Host reset/base CSS and the current theme
through `/util/add-style.js`. Colors, font families, borders, selection/focus/disabled
appearance, widgets, keyboard behavior and tooltip ownership remain shared.

**Any addition to View-specific CSS requires fresh explicit user approval.**
Do not use this exception to introduce further local styling or generic sizing
utilities. Do not extend shared Host/theme CSS or the protected View guide for
these sizing exceptions. Keep the exception recorded here and in the README.

The actual View owns this layout, so native GAMS and the browser harness run the
same code. Do not reintroduce a browser-only sizing override or monkeypatch.

## Source, packaging and docs

Canonical View code lives under `src/views/`; build-time catalog SQL and its
builder live under `scripts/`, outside the packaged View. The local Project and
preview use the same View code and configured database file; fixture paths remain
Project-local. Do not vendor fixtures or Host APIs into src/.
`npm test` is fixture-independent; `make check` additionally validates local LPC
fixtures and the sibling Host. Follow template.view packaging/wiki conventions.
Version 0.0.0 is a local packaging placeholder, not a production release.
No release publisher, production version, tag or publication is part of this alignment.
