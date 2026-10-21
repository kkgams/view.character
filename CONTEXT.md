# view.character

A pre-alpha SQLite catalog browser and transient character composer. The Host
owns runtime, SQL helpers, widgets, UI Services and theme styling. This repository
owns the single deployable View, local `gams.json`, preview and consumer tests.
It owns no source artwork, extraction, database-building schema or migrations.

## Inventory terminology and tooltips

The inventory is the available-item grid for the currently active equipment slot.
Inventory item tooltips show only the catalog item name, without a slot prefix or
extra details. The remove choice retains its unequip action label. Equipment tips
and accessible labels distinguish missing animation from incompatible body;
additional body-type tooltip metadata is deferred.

## Database input

`gams.json` selects `catalog/catalog.sqlite`.

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
The local ignored symlink may point to any externally built compatible catalog;
the producer's source structure and tools are not View dependencies.

The ignored local `catalog` directory symlink targets the sibling
`view.character.catalog1` checkout. Only its `catalog.sqlite` crosses the runtime
boundary; this is development wiring, not an import or build dependency. A regular
supplied database at the configured path works without that repository. The
code-only baseline contains no database. Close/reopen the Project or preview after
external atomic database replacement.

## Runtime contract

The user-approved runtime changes supersede prior database-required animation
geometry/timing and indexed-only expectations. SQLite `animations` supplies
`id, name`; temporary explicit `animationSettings` at the top of the View supplies
geometry, directions, sequence and timing: 100ms frames, idle 400ms, climb/hurt
S only (otherwise NESW). Unsupported animation IDs fail visibly. Unsupported
equipped parts are omitted with reason-specific warning/danger states, never
fabricated frames.

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
Image decoding remains capped at eight concurrent decoders.
Icons browser-decode original supplied bytes, format and size, without 32px,
indexed or GPL assumptions. Indexed sprite PNGs preserve indices, including
duplicate RGB roles; other browser-supported formats retain original RGBA, with
no fabricated palette indices or recoloring. Indexed defaults use original sprite
palettes, without assuming exact GPL matches. GPL alternatives require equal
index counts. GPL names and ordered entries remain catalog-owned.

Layers accept any positive safe integer as numeric paint order, not a fixed
inventory. Masks operate on target drawing buffers before flattening; duplicate
drawing occupancy remains an error. See `docs/layers.md`.

### Responsive item selection and atomic preview

Inventory item activation immediately updates `parts`/`colors` and
`aria-selected` in the existing inventory DOM, retaining focus and search state.
Update only the changed equipment cell and selected palette controls; do not
rebuild the full inventory or equipment board. Recolor controls apply only to
the active slot's equipped item, in an aside above the inventory; hide them
when that slot is empty or no slot is active. No CSS changes are authorized.

While a replacement is pending, retain the old complete preview clip and show
“Rendering character preview…” in the footer and the `ui.toast` service's centered
indeterminate progress notification (`position: "modal"`). Transition that same
notification to success/error. Supersession, Reset and disconnect close obsolete
progress; dismissing a notification does not cancel rendering. The preview uses
the canonical sibling toast service, not a View-local loading overlay. Selected-pack SQL loading is already asynchronous;
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
No CSS or protected View-guide changes are part of this policy.

Selections are transient. Every slot may unequip; startup and Reload/Reset leave
all equipment slots empty. Reload/Reset resets transient state.
There is no asset CRUD, persistent character state or production editor here.

## Development and release boundary

`npm test` and `make check` are independent of catalog sources and supplied artwork.
`make preview` uses canonical sibling Host/theme sources and the configured SQLite
file. Native packaged-app startup remains unverified. Preserve the exact approved
View-local sizing exception in `AGENTS.md`; other styling remains shared.

The archive contains View code and release metadata, not a database or artwork.
Version 0.0.0 is a packaging placeholder. Production read-only enforcement,
release publication and asset distribution approval remain separate work.
The earlier `CHARACTER_STUDIO_AGENT_SPEC.md` is design history, not additional
implementation acceptance criteria.
