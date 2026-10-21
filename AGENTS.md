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

Startup and Reset query only slots and animations through Host `/util/sql.js`.
All equipment is empty and `selectedSlot` is `null`; no inventories, sprite
metadata or palettes load, and no palette UI is shown.

Activating a slot first loads its inventory metadata: select `id, name, slot, palette`
without image bytes using `WHERE slot = ? ORDER BY id LIMIT 512`, then
`WHERE slot = ? AND id > ? ORDER BY id LIMIT 512` for subsequent pages.
Before the first inventory cells or icon requests, load availability for the
current animation/body as paged item `id` and `supported` flags, not full sprite
metadata or BLOBs. Use a set-based `LEFT JOIN` from `items` to the derived
`SELECT DISTINCT item FROM sprites WHERE animation = ? AND mask = 0 AND instr(body, ?) > 0`;
a matching drawing row means supported. Filter by slot, order by SQL item ID and
limit each output page to 512 rows, adding an item-ID keyset bound after the first
page. Do not use a per-item correlated support query.

Cache support on first use per slot/animation/body until Reset. Animation changes
refresh the active inventory's support asynchronously without replacing its
cells or losing focus, search or decoded icons. Pending/unknown support is not
unsupported. Only current results may update the active UI; stale slot,
animation/body, Reset or disconnect results must not publish stale warnings.
Existing missing-animation warning styling, accessible names and UI Service
tooltips remain shared and unchanged.

Equipping still loads full sprite metadata only for the selected item, without
BLOBs, using `WHERE item = ? ORDER BY id LIMIT 512`, then
`WHERE item = ? AND id > ? ORDER BY id LIMIT 512`. The first equip also loads
the full palettes table for alternatives. Inventories, support flags, item sprite
metadata and palettes are cached until Reset; Reset also invalidates pack, icon
and render caches and transient selections. Stale Reset/disconnect results must
not repopulate caches or publish UI.

Names and ordering remain SQL-owned; slots use `ORDER BY "order", id` without
order-value validation. Sprite BLOBs still load lazily per exact selected pack.
No schema/data writes, producer indexes, FS access or source fallback are added.
The current slot/item-filtered metadata queries may scan; native selection performance
under this demand-loading policy remains unverified.

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
Icons load progressively for the current inventory, prioritizing its equipped
item's icon when revisiting a slot. Each request uses
`SELECT id, icon FROM items WHERE id IN (...) ORDER BY id` with at most 10 bound
item IDs. Render each completed batch, then yield before requesting the next.
Cache fetched/decoded icons; do not eagerly load every inventory. Switching slots
cancels queued work for the old inventory. Reset/disconnect invalidates stale
in-flight results so they cannot repopulate caches or update the current cells.
Loading placeholders retain current cell accessible names, shared grid behavior
and Host/theme styling; no additional View-local CSS is authorized.

Equipment slot activation changes the active inventory without character
recomposition. Uncached slots request inventory metadata, then current
animation/body support flags before showing cells and starting progressive icon
SQL. A revisit is SQL-free only when inventory, current support and icons are
cached; a new animation/body support key still requires its first query.
Image decoding retains its eight-decoder cap.
Icons browser-decode original supplied bytes, format and size, with no 32px,
indexed-PNG or GPL assumptions. Indexed sprite PNGs preserve indices, including
duplicate RGB roles; other browser-supported formats retain original RGBA without
fabricated palette indices or recoloring. Indexed defaults use the sprite's
original palette, not an assumed exact GPL match; alternatives require equal
index counts.

Every slot may unequip. Startup and Reset leave all equipment slots empty.
Layers accept any positive safe integer as numeric paint order, with no fixed
inventory. Composition applies masks to separate target drawing buffers,
then flattens numerically. Duplicate drawing occupancy remains an error, not a
priority rule. See `docs/layers.md`.

## Approved responsive item selection

Inventory item activation immediately updates `parts`/`colors` and
`aria-selected` in the existing inventory DOM, retaining focus and search state.
Update only the changed equipment cell and selected palette controls; do not
rebuild the full inventory or equipment board. Recolor controls apply only to
the active slot's equipped item, in an aside above the inventory; hide them
when that slot is empty or no slot is active. No CSS changes are authorized.

While a replacement is pending, retain the old complete preview clip and show
“Rendering character preview”. Selected-pack SQL loading is already asynchronous;
yield at a paint boundary before composition, then compose one frame per yield.
The Host shared widget asynchronously validates/copies RGBA in bounded chunks.
Commit only a complete clip for the latest selection, atomically; never publish
partial frames. Rapid item changes, Reset entry and disconnect cancel stale work.
Pixel, mask, numeric layer-order and animation semantics remain unchanged.

This intentionally requires the new Host API
`WidgetAnimationPreview.setClipAsync(value, isCurrent): Promise<boolean>`.
The existing clip API remains unchanged for other consumers. Update/rebuild the
sibling Host before using this View; an older downloaded Host without the new
method must fail visibly, not fall back to synchronous clip installation.
No CSS or protected View-guide changes are authorized by this policy.

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

A subsequent explicit user approval adds **16px top-right equipment conflict
badges only**, positioned 2px from the corner. They use the shared Material
`warning` icon and theme `--warning` color; badges are decorative, with conflict
details in the cell's accessible name and UI Service tooltip. Both implicated
slots are marked, without suppressing the rendering failure. This does not
introduce a shared badge contract or authorize other local styling.

**Any addition to View-specific CSS requires fresh explicit user approval.**
Do not use this exception to introduce further local styling or generic sizing
utilities. Do not extend shared Host/theme CSS or the protected View guide for
these sizing exceptions. Keep the exception recorded here and in the README.

The actual View owns this layout, so native GAMS and the browser harness run the
same code. Do not reintroduce a browser-only sizing override or monkeypatch.
