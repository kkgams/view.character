---
title: Character prototype
status: in-progress
---

# Character prototype

`view-character` consumes a supplied SQLite database; the deployable View remains
one self-contained file and never extracts artwork or patches the Host.

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

Names and ordering remain SQL-owned; slots use `ORDER BY "order", id` without
order-value validation. Sprite BLOBs still load lazily per exact selected pack.
No schema/data writes, producer indexes, FS access or source fallback are added.
The current slot/item-filtered metadata queries may scan; native selection performance
under this demand-loading policy remains unverified.

SQL result ordering is authoritative: slots use `ORDER BY "order", id` with no
order-value validation. SQLite animations supply `id, name`; temporary explicit
`animationSettings` at the top of the View provides geometry, directions, sequence
and timing (100ms frames, idle 400ms, climb/hurt S only; otherwise NESW).
Unsupported animation IDs fail; unsupported equipped parts are omitted with
reason-specific warning/danger states. This user-approved runtime policy supersedes
prior database-required animation and indexed-only expectations.

`selectAnimationPack(item, state, database = sql)` selects from SQL-ordered cached
`item.sheets` metadata: first body compatible with `state.body`, then every
drawing/mask row with that exact body value. It fetches raw sprite BLOB rows by
bound exact opaque primary-key IDs, using
`WHERE item = ? AND animation = ? AND body = ? AND id IN (...) ORDER BY id`
in chunks of at most 256 IDs. Missing or changed returned pack IDs fail loudly
and require Reset. Character body is temporarily `m`; never parse sprite ID
suffixes. Later body/pack policy changes belong only in `selectAnimationPack`,
with its signature unchanged.

Supply the database configured by `gams.json` (`catalog/catalog.sqlite` locally),
using a regular file or the ignored development directory symlink.
Catalog sources and production tooling live outside this View repository. Close
and reopen the Project/preview after externally replacing the database file.
Reset invalidates pack, icon and render caches and transient selections, not
database records.

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
Every slot may unequip. Startup and Reset leave all equipment slots empty.
Icons browser-decode original supplied bytes, format and size, without 32px,
indexed or GPL assumptions. Indexed sprite PNGs preserve indices
and default to their original palette, not an assumed exact GPL match;
alternative recoloring requires equal index counts. Other browser-supported
formats retain original RGBA without fabricated palette indices or recoloring.
The [[layers|layer contract]] accepts any positive safe integer as numeric paint
order, with no fixed inventory. Masks target drawing buffers before flattening;
duplicate drawing occupancy remains an error. Approved CSS stays unchanged.

## Responsive item selection and atomic preview

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
This experimental slice changes geometry only; table transparency and pointer
pass-through are not implemented. No View-local CSS is added, and the protected
Host View guide is unchanged.
Native demand-loaded item-selection performance remains unverified.

See the [README](https://github.com/kkgams/view.character#readme) for launch,
controls, checks and the approved View-local sizing exception. The loopback
preview uses canonical Host/theme code and real SQLite transport, with stubbed
runtime/chrome. Native packaged-app startup remains unverified.

`npm run package` contains View code only: no database, artwork or catalog build
tools. Version 0.0.0 is a local packaging placeholder, not release preparation.
