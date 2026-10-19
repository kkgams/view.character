# view.character instructions

Follow the workspace rules and protected `../gams/docs/gams-view-development-guide.md`.
This directory is an independent Git repository. Keep its history and releases
separate from sibling repositories and the workspace root. Local `fixtures/`,
installed Units and the entire `tools/` directory are intentionally ignored.
Keep maintained development/check scripts in tracked `scripts/`; reserve
`tools/` for local/downloaded tool artifacts.

## Development fixture preparation and repository tracking

Download/prepare real fixtures before artwork, animation or conversion development;
do not replace missing sources with invented sprites or assume a fresh checkout
already has ignored inputs. Run `make fixture-repos`, `make animation-fixtures`,
and, for the visual prototype, `make fixtures ASEPRITE=/absolute/path/to/aseprite`.
That target also prepares runtime motion fixtures; `make motion-fixtures` refreshes
those alone from `scripts/lpc-motion-fixtures.json`.
Fixture-independent tests/packaging must remain usable without these downloads.

`scripts/fixture-repositories.json` is the tracked repository-source inventory.
Record every new repository download there: canonical URL, exact commit SHA,
clone versus selected-file mode, local locations, preparation path, and the
manifests that hold file hashes/licensing. OGA/archive sources remain recorded in
their file-level manifests. Full clones belong under ignored `fixtures/repos/`;
they are development inputs, never submodules, vendored View source or releases.
The Universal LPC working tree is `fixtures/repos/universal-lpc-generator` at
its registered pin. `make check-fixture-repos` verifies it offline. Never silently
pull, switch revisions, reset, clean or overwrite an existing fixture checkout;
preserve experiments and change source pins deliberately with related metadata.
No upstream install/build scripts are run merely to prepare the repository.

## Ahead-of-time database build

`make database` runs `scripts/build-database.py` to create ignored `db.sqlite`
from `scripts/catalog.sql` plus the name registry in `scripts/lpc-animations.json`;
`DATABASE=other.sqlite` overrides the output (also update `gams.json`).
`make animation-fixtures` fetches the 12 pinned default body/head source pairs.
The database target also uses Aseprite to generate `docs/animations.md` and its
body/head-only GIFs and static pose PNGs. That page is only the current Project selection, with its
table first; `docs/animation-reference.md` is the separate research/history and
source-layout identification page. Both are generated from their templates in
`scripts/`. Research discoveries do not automatically expand the Project registry. It verifies source hashes and round-tripped preview pixels.
Fixture-free tests can build schema/registry without rendering docs. These raw
RGBA sheets are not yet the indexed catalog importer; items/sprites stay empty.
The source-reference Climb exception is one north-only row, not fabricated
four-direction data. Keep attribution/license with the generated docs artwork. It builds afresh, checks foreign keys/integrity, and atomically
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
10-entry animated-clip name registry, queried on reload for the side-panel
select beside Play. Emotes and Sitting are two source pose sheets, not clips:
the preparation manifest selects their 7 individual static poses and renders
single-frame PNGs. Poses are not seeded into the animation table. The View's
grouped selector reads clip names from SQLite and pose names from the prepared
`fixtures/lpc/motion-catalog.json`; do not hardcode a parallel UI name list.
All 10 prepared clips use real source cells and explicit timing; 7 poses remain
single held frames with Play disabled. Climb exposes north only. Render every
equipped part that contains the selected source cells/direction; omit unsupported
parts from composition but keep them equipped and interactive. Mark unsupported
equipment and inventory cells with shared `.danger` intent, include accessible
coverage explanations and name omitted parts in status. Playback stays available
while at least one equipped part supports the clip. Never substitute Idle,
fabricate frames/directions, silently omit parts or cycle pose-sheet columns.
The source manifest pins 221 raw sheets and 19 explicit absences. Per-item frame
counts remain actual (most Emotes parts have 3 columns, default body/head 4).
Pose persistence, indexed folder import and database sprite playback remain
separate work. Artwork/palettes still use external fixture mocks.
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

## Independent animation research catalog

`assets/lpc/animations.json` is an independently pinned research catalog, not a
replacement for `scripts/lpc-animations.json` or a runtime importer. It records
source-specific original/unified, Revised/Expanded, modern Universal and optional
community variants. Preserve source definition/physical ordering, unknown fields,
license/author chains and byte-identical raw files. Do not infer full-sheet rows
from split-strip rows, gameplay timing from previews, or OGA-BY permission from
collection membership. See `CONTEXT.md` → LPC Animation Reference and
`assets/lpc/ATTRIBUTION.md`. `scripts/validate_lpc_animations.py` validates offline;
`scripts/fetch_lpc_catalog.py` restores missing pins without overwriting modified
files. These mixed-license research assets remain outside the code-only archive
and are not production integration approval. Do not connect them to the View or
rewrite the existing database registry as an incidental research update.

## Source, packaging and docs

Canonical View code lives under `src/views/`; build-time catalog SQL and its
builder live under `scripts/`, outside the packaged View. The local Project and
preview use the same View code and configured database file; fixture paths remain
Project-local. Do not vendor fixtures or Host APIs into src/.
`npm test` is fixture-independent; `make check` additionally validates local LPC
fixtures and the sibling Host. Follow template.view packaging/wiki conventions.
Version 0.0.0 is a local packaging placeholder, not a production release.
No release publisher, production version, tag or publication is part of this alignment.
