# view.character instructions

Follow the workspace rules and protected `../gams/docs/gams-view-development-guide.md`.
This independent repository owns the SQLite-consuming View and its local Project,
preview, tests, packaging and wiki. It does not own asset extraction, source
fixtures, schema creation or catalog production.

## SQLite boundary

The only catalog input is the database configured in `gams.json`, currently
`catalog/catalog.sqlite`. Local development uses an ignored `catalog` directory
symlink; a supplied regular database at the configured path also works. Never add a runtime dependency on catalog
sources, extraction tools, raw images or the producer repository. Missing schema
or malformed required state must fail visibly, without creating or repairing it.

The View queries metadata during reload/Reset in bounded pages through Host
`/util/sql.js`; sprite BLOBs are fetched/decoded lazily per selected pack.
Item and sprite metadata use 512-row SQL keyset pages ordered by `id`, with
`WHERE id > ?` on subsequent pages, bounding native WIT/JSON response memory.
Other tables load in full. Names and ordering remain SQL-owned. It never writes
schema/data or reads FS. Reload invalidates pack, icon and render caches and
transient selections, not database records. SQL result ordering is the sole
ordering authority: slots use `ORDER BY "order", id`; do not validate order values.

The user-approved runtime policy supersedes prior database-required animation
geometry/timing and indexed-only expectations. SQLite `animations` supplies only
`id, name`; temporary explicit `animationSettings` at the top of the View supplies
geometry, directions, sequence and timing (100ms frames; idle 400ms; climb/hurt
S only). An unsupported animation ID fails visibly.

`selectAnimationPack(item, state, database = sql)` selects from SQL-ordered cached
`item.sheets` metadata: first body compatible with `state.body`, then every
drawing/mask row with that exact body value. It fetches raw sprite BLOB rows by
bound exact opaque primary-key IDs, using
`WHERE item = ? AND animation = ? AND body = ? AND id IN (...) ORDER BY id`
in chunks of at most 256 IDs. Missing or changed returned pack IDs fail loudly
and require Reset. Character body is temporarily `m`; never parse sprite ID
suffixes. Later body/pack policy changes belong only in `selectAnimationPack`,
with its signature unchanged.
Equipment slot activation only changes the active inventory slot; it performs
no SQL or character recomposition. Image decoding retains its eight-decoder cap.
Icons browser-decode original supplied bytes, format and size, with no 32px,
indexed-PNG or GPL assumptions. Indexed sprite PNGs preserve indices, including
duplicate RGB roles; other browser-supported formats retain original RGBA without
fabricated palette indices or recoloring. Indexed defaults use the sprite's
original palette, not an assumed exact GPL match; alternatives require equal
index counts.

Every slot may unequip. Initially select its first item in SQL result order when
present. Layers accept any positive safe integer as numeric paint order, with no
fixed inventory. Composition applies masks to separate target drawing buffers,
then flattens numerically. Duplicate drawing occupancy remains an error, not a
priority rule. See `docs/layers.md`. No Host changes are part of this policy.

## Source and checks

The View is one self-contained `src/views/view-character.js`; no relative local
module imports. Host-owned `/core`, `/util` and `/widgets` imports remain allowed.
Do not vendor Host/theme helpers. The preview serves canonical sibling Host/theme
sources and real SQLite transport; native packaged-app startup remains unverified.

`npm test` and `make check` require no artwork, catalog producer checkout or
prepared database. Consumer tests use synthetic SQL records and PNGs, not the
producer's schema builder. Keep this boundary enforced by `scripts/verify.mjs`.
`make check-webkit` additionally requires a running preview and macOS. Replacing
the database atomically does not switch an open SQLite connection: close/reopen
the Project or preview after rebuilding externally.

Code-only packaging/wiki follow template.view. Version 0.0.0 is a local tooling
placeholder, not production release preparation. No commits, tags or publishing
unless explicitly requested.

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
