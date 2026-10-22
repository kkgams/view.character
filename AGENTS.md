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

Startup and Reset still issue exactly two queries: slots and animations through
Host `/util/sql.js`.
All equipment is empty and `selectedSlot` is `null`; no inventories, sprite
metadata or palettes load, and no palette UI is shown.

Activating a slot first loads its inventory metadata: select `id, name, slot, palette`
without image bytes using `WHERE slot = ? ORDER BY id LIMIT 512`, then
`WHERE slot = ? AND id > ? ORDER BY id LIMIT 512` for subsequent pages.
The approved flow is **data → icons → compatibility**: show inventory cells
immediately after metadata loads, then progressively fetch, decode and publish
the currently demanded inventory icons. Only after those icons are ready and a
paint yield may current animation/body compatibility checks begin.

Compatibility queries return only item `id`, `supported` and `hasAnimation`
flags for selected opaque IDs in batches of at most 10. A set-based `LEFT JOIN`
joins items to drawing rows grouped by item, filtered by `animation = ? AND
mask = 0` and the same bounded IDs. The derived `MAX(instr(body, ?) > 0)`
supplies body support; presence of the group supplies animation support.
The body selector uses `MAX(1)` without a body parameter to offer all shapes.
Restrict outer items to the slot and the same IDs; preserve SQL ID ordering.
No per-item correlated query, full sprite metadata or BLOBs are loaded.
Mask-only rows count as missing animation. Loaded metadata uses the same
classification. Update cell status after each batch and yield before the next.

Cache partial status maps per slot/animation/body until Reset and reuse cached
statuses: `supported`, `missing-animation` or `body-mismatch`. Missing entries
in an incomplete map are pending/unknown, not unsupported; a missing item in a
completed map is an invariant violation.
Changing search can add icon demand, pausing compatibility checks until those
icons are fetched, decoded and published and a paint yield allows checks to
restart. Slot or animation changes cancel obsolete queued compatibility work.
Animation changes retain inventory nodes, search, focus and decoded icons.
Only current results may update the active UI; stale slot or animation/body
results must not publish compatibility statuses. Reset/disconnect drops stale results so they
cannot repopulate caches or publish UI.

The approved status split uses shared `warning` styling for a missing current
animation and shared `danger` styling when a drawing exists for the animation
but its body is incompatible. Accessible cell labels and equipment UI Service
tips distinguish these reasons. Inventory item tips remain catalog-name-only,
without a slot prefix or status details; the remove choice keeps its unequip
action label. Drawing-layer conflicts remain `danger` plus the decorative
warning triangle on both implicated equipment cells, with conflict details in
accessible names and equipment tips; conflicts take precedence over availability
styling and still fail rendering. This adds no View-local CSS or guide changes.

Equipping still loads full sprite metadata only for the selected item, without
BLOBs, using `WHERE item = ? ORDER BY id LIMIT 512`, then
`WHERE item = ? AND id > ? ORDER BY id LIMIT 512`. The first equip also loads
the full palettes table for alternatives. Inventories, compatibility statuses,
item sprite metadata and palettes are cached until Reset; Reset also invalidates pack, icon
and render caches and transient selections. Stale Reset/disconnect results must
not repopulate caches or publish UI.

Names and ordering remain SQL-owned; slots and animations use `ORDER BY "order", id` without
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
and require Reset. `DEFAULT_BODY_TYPE = "m"` initializes character body. Equipping an item in
`BODY_SLOT_ID = "body-z12"` sets `this.body` from its sprite metadata after loading;
assert exactly one valid body code across all its animations. Never parse sprite
ID suffixes. This first step leaves unequipping/Clear body-mode behavior unchanged
(the last mode remains until Reset).
Availability checks for `BODY_SLOT_ID` require a drawing for the selected animation
but ignore the current character body, both in batched SQL and loaded metadata.
This lets users select a different shape. All other slots still match `this.body`;
missing animations and mask-only rows remain unsupported. Later body/pack policy changes belong only in `selectAnimationPack`,
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
recomposition. Uncached slots load metadata and immediately show cells, then
load demanded icons before compatibility checks. A revisit is SQL-free only
when inventory, demanded icons and all current inventory compatibility statuses
are cached; a new animation/body support key requires checks after demanded icons
are ready.
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
yield at a paint boundary before composition, then compose offscreen frame
canvases one per task yield. The View stores the complete clip as
`this.previewClip = { width, height, frames: [{ canvas, durationMs }] }` and
publishes it atomically only for the latest request; never publish partial frames.
Rapid item changes, Reset entry and disconnect cancel stale work. The View owns
looping `setTimeout` playback and pauses it on disconnect and Reset. The current
complete clip remains visible until its replacement is ready.
Pixel, mask, numeric layer-order and animation semantics remain unchanged.

The main preview uses the Host's unmodified `ViewCanvasBase` helper through
`/util/view-canvas-base.js`, with a temporary View-owned shadow mounting adapter.
Small icons and palette previews still use `widget-animation-preview` with its
synchronous `clip` API; the main preview no longer requires `setClipAsync`.

Viewport pan, zoom and fit redraw the completed clip without recomposition.
The existing **Preview zoom** 1×–4× control remains independent of viewport zoom.
Shared Host `base.css` overlaps adjacent main-form canvas/table children, including
shadow-root forms: the canvas fills the viewport beneath the table and stays in
place while oversized equipment scrolls. The central `rowspan` cell remains empty.
The stacked table passes pointer input to the canvas except at `[aria-selected]`
elements. Transparency remains pending; no View-local CSS is added.

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
now, to size the equipment/inventory cells instead of drawing the
equipment/inventory UI on canvas. The main character preview uses ViewCanvasBase.

The approval is limited to `APPROVED_LAYOUT_CSS` in `src/views/view-character.js`: fixed 64×64 slot
cells, fixed outer equipment columns, and inventory table width determined by its
slot columns. The canvas migration removes the legacy central-widget sizing and
scrolling CSS only; no new CSS is approved. The central rowspan cell stays empty,
with shared Host CSS providing canvas/table overlap and pointer pass-through
outside `[aria-selected]` elements. Cell transparency remains pending.
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
details in the cell's accessible name and equipment UI Service tooltip. Both
implicated slots retain shared `danger` styling plus the warning triangle,
without suppressing the rendering failure. This does not introduce a shared badge contract or authorize other local styling.

**Any addition to View-specific CSS requires fresh explicit user approval.**
Do not use this exception to introduce further local styling or generic sizing
utilities. Do not extend shared Host/theme CSS or the protected View guide for
these sizing exceptions. Keep the exception recorded here and in the README.

The actual View owns this layout, so native GAMS and the browser harness run the
same code. Do not reintroduce a browser-only sizing override or monkeypatch.
