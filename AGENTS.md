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
and, for historical offline samples, `make fixtures ASEPRITE=/absolute/path/to/aseprite`.
That target also prepares offline motion fixtures; `make motion-fixtures` refreshes
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

`make catalog-fixtures` prepares one lossless indexed body Walk item under ignored
`catalog/`, from previously downloaded pinned originals. It preserves
originals and refuses to overwrite changed derived inputs. `scripts/catalog-sample/`
holds bootstrap JSON; prepared folder JSON is authoritative for subsequent builds.
Keep conversion separate from importing. Do not quantize, fabricate directions,
or independently assign palette indexes per sheet/icon.

`make database` imports `CATALOG` (default `catalog`) into ignored
`DATABASE` (default `db.sqlite`) using `scripts/catalog.sql` for schema only.
Slots and animations come from folder JSON, items from directories/data.json,
and sprites from explicit `<animation>_<layer>[m].png` names. Indexed item drawings
and 32×32 icon share one palette, including transparent index 0. Item `data.json`
requires `palette`, referencing `palettes/<id>.gpl` by filename stem. SQLite
`palettes(id,name,data)` retains the stem, GPL `Name:` and unchanged UTF-8 GPL
text (including line endings/comments/color names). GPL colors map to PNG indexes
1..N in file order; never sort/deduplicate/remap them. Index 0 is implicit, not a
GPL entry. Validate the embedded PNG palettes against GPL; masks remain independent. Binary masks have
opaque black/white index 0/1 and do not use the item palette. See `docs/layers.md`.
Animations store frame width/height, count per direction, explicit `directions`
fixed to `NESW`, and playback sequence/durations JSON arrays. Upstream NWSE artwork
must be reordered in preparation, never relabeled without changing rows. The first
slice imports Walk only; north-only Climb and held poses are not normalized yet.

The same definitions generate `docs/animations.md`, verified against SQLite and
rendered from prepared indexed sprites through Aseprite. Current documentation
requires exactly one reference item and retains credited body-only Walk GIFs.
The broader `docs/animation-reference.md` is separate source research, not rewritten
by the catalog build. Import/render validation finishes before publishing outputs;
failed validation preserves the previous database. No migrations/history.
Close Project/preview before replacing the database and reopen afterward.

## Pre-alpha catalog SQL and View boundary

The View queries all slots, items, icons, sprite BLOBs, GPL palettes and animations
through shared Host `/util/sql.js` on every reload/Reset. It never writes schema/data
or reads FS. Reset clears decoded/render caches and transient selections; manual
database edits survive. No runtime mock/motion catalogs or fixture fallbacks.

`src/views/view-character.js` parses GPL and decompresses indexed PNGs, preserving
indexes even when RGB entries repeat. Validate references, NESW geometry, playback
timing and binary masks. Keep separate drawing-layer buffers, apply masks to their
targets, then flatten in numeric order. Competing equipped drawings on one layer
fail; slot order is independent of paint order. No metadata defaults or layer table.

Initially equip the first item by stable ID in each nonempty slot; all slots may
unequip, with no required body/head model. Show palette rows only for slots with
items, use SQLite GPL names, filter alternatives by equal palette index count and
default to each item's palette. Do not infer materials. Geometry and timing are
solely database-defined, fixed NESW four-direction. Only body Walk is currently
imported; no raw clips or poses are automatically adopted. Catalog information
stays generic. Preserve provenance in prepared inputs/generated docs, not a SQL
author schema. Keep source/research fixtures as offline preparation history.

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

Each View must be one self-contained JavaScript file. Keep View-owned parsing,
loading and composition code in `src/views/view-character.js`; do not import
relative companion modules. Host-owned absolute `/core`, `/util` and `/widgets`
imports remain allowed. GAMS intentionally loads the standalone file without a
base URL for resolving View-local dependencies. Tests must enforce this boundary.

Canonical View code lives under `src/views/`; build-time catalog SQL and its
builder live under `scripts/`, outside the packaged View. The local Project and
preview use the same View modules and configured database file. The preview serves
canonical Host/theme sources and SQL transport, with no FS routes or fixture startup
requirements. Native Tauri packaged-app startup remains unverified.
Do not vendor fixtures or Host APIs into src/.
`npm test` is fixture-independent; `make check` additionally validates local LPC
fixtures and the sibling Host. Follow template.view packaging/wiki conventions.
Version 0.0.0 is a local packaging placeholder, not a production release.
No release publisher, production version, tag or publication is part of this alignment.
