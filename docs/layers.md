---
title: Layer contract
status: reference
---

# Layer contract

Layer IDs are **any positive safe integer** and define numeric paint order:
lower numbers are behind higher numbers. There is no fixed layer inventory,
`layers` table, layer foreign key or separate render-order field. A slot does
not imply a layer. Duplicate drawing occupancy remains an error, not a priority
rule; masks do not claim drawing occupancy.

These user-approved runtime changes supersede earlier fixed-layer,
database-required animation geometry/timing and indexed-only expectations.

## SQL ordering and animation packs

SQL result ordering is the sole ordering authority. Slots use
`ORDER BY "order", id`; the View does not validate order values. Startup and Reset
leave all equipment slots empty; every slot may unequip.

SQLite `animations` supplies only `id, name`. Temporary explicit
`animationSettings` at the top of `src/views/view-character.js` supplies frame
geometry, directions, sequence and timing. Frames last 100ms, except idle frames
at 400ms. Climb and hurt use S only; other supported animations use NESW.
Unsupported animation IDs fail visibly rather than inferring settings.

`selectAnimationPack(item, state, database = sql)` selects from SQL-ordered cached
`item.sheets` metadata: first body compatible with `state.body`, then every
drawing/mask row with that exact body value. It fetches raw sprite BLOB rows by
bound exact opaque primary-key IDs, using
`WHERE item = ? AND animation = ? AND body = ? AND id IN (...) ORDER BY id`
in chunks of at most 256 IDs. Missing or changed returned pack IDs fail loudly
and require Reset. Character body is temporarily `m`; never parse sprite ID
suffixes. Later body/pack policy changes belong only in `selectAnimationPack`,
with its signature unchanged. Unsupported equipped
parts are omitted with reason-specific warning/danger states, without invented
frames or Idle substitutions.

## Image and palette records

Icons load progressively for the current inventory, prioritizing equipped
items too. Each request uses
`SELECT id, icon FROM items WHERE id IN (...) ORDER BY id` with at most 10 bound
item IDs. Render each completed batch, then yield before requesting the next.
Cache fetched/decoded icons; do not eagerly load every inventory. Switching slots
cancels queued work for the old inventory. Reset/disconnect invalidates stale
in-flight results so they cannot repopulate caches or update the current cells.
Loading placeholders retain current cell accessible names, shared grid behavior
and Host/theme styling; no additional View-local CSS is authorized.

Icons browser-decode the original supplied bytes in their original format and
size. There is no 32px, indexed-PNG or GPL assumption for icon data. The approved
CSS sizing of empty/remove UI icons is a separate, unchanged layout exception.

Sprite BLOBs are fetched and decoded lazily per selected animation/body pack.
Indexed PNG decoding preserves original indices, including duplicate RGB roles;
never recover indices by matching decoded RGB pixels. Other browser-supported
image formats decode to original RGBA with no fabricated palette indices and no
recoloring.

Indexed sprites default to their **original embedded palette**, not an assumed
exact match with GPL colors. Alternative recoloring requires an equal palette
index count; RGBA sprites remain unchanged. Mask colors are independent of item
palette selections.

`palettes(id, name, data)` stores the filename stem, required GPL `Name:` value,
and full original UTF-8 GPL text. Comments, spacing, line endings, `Columns:` and
color names are preserved. No JSON color array is persisted. Named colors have
no automatic material semantics.

GPL requires `GIMP Palette` on the first line, one nonempty `Name:`, optional
`Columns:` (0–256), comments starting with `#`, and 1–255 RGB entries (0–255).
Color names are optional and may contain spaces. Metadata precedes entries.
Transparent index 0 is implicit for parsed GPL alternatives; GPL has no alpha
channel. These GPL rules do not constrain supplied icon or RGBA image formats.

## Composition and conflicts

For one active animation and the selected packs:

1. Resolve every drawing/mask component and validate positive safe integer layers.
2. Detect duplicate drawing occupancy before painting. Conflicting equipped
   items/slots on one layer fail with the animation, layer and both slot/item
   IDs. No priority, fallback, last-writer-wins or slot-derived tie-breaker exists.
   Catalog alternatives may share a layer; the conflict is composition-specific.
   Both implicated equipment slots retain shared `danger` styling plus decorative
   corner warning triangles, with the error in their accessible names and
   equipment UI Service tooltips. Structured slot/item IDs identify the cells; the error string is never parsed. Badges
   clear when a new preview request starts; stale requests cannot restore them.
   The user-approved View-local badge CSS changes no layer or rendering policy.
3. Draw normal components into separate layer buffers using original pixels or
   a compatible indexed palette alternative.
4. Apply masks to their target drawing buffers: black keeps, opaque white erases.
   Masks use their own pixels, never the item's selected color palette. Multiple
   masks combine deletion; a mask on a currently empty target has nothing to erase.
5. Composite buffers in ascending numeric layer order. Never erase from the
   already-flattened character; a hair mask must not remove its face or clothing.

## Responsive selection and atomic clip publication

Inventory item activation immediately updates `parts`/`colors` and
`aria-selected` in the existing inventory DOM, retaining focus and search state.
Update only the changed equipment cell and selected palette controls; do not
rebuild the full inventory or equipment board.

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
This changes scheduling and publication only, not the composition rules above.

Viewport pan, zoom and fit redraw the completed clip without recomposition.
The existing **Preview zoom** 1×–4× control remains independent of viewport zoom.
Shared Host `base.css` overlaps adjacent main-form canvas/table children, including
shadow-root forms: the canvas fills the viewport beneath the table and stays in
place while oversized equipment scrolls. The central `rowspan` cell remains empty.
This experimental slice changes geometry only; table transparency and pointer
pass-through are not implemented. No View-local CSS is added, and the protected
Host View guide is unchanged.

## SQLite input boundary

Startup/Reset still issues exactly two queries: slots and animations through
Host `/util/sql.js`. No slot is selected; inventory and recolor controls start
empty. Slot activation first loads item metadata (`id, name, slot, palette`)
with `WHERE slot = ?`. The approved flow is **data → icons → compatibility**:
show cells immediately after metadata loads, progressively fetch, decode and
publish the currently demanded inventory icons, then yield for paint before
starting current animation/body compatibility checks.

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
Search changes can add icon demand and pause compatibility checks until those icons
are fetched, decoded and published and a paint yield allows checks to restart.
Slot or animation changes cancel obsolete queued compatibility work. Animation
changes retain inventory nodes, search, focus and decoded icons. Only current
results may publish compatibility statuses; stale slot or animation/body results cannot update
active UI. Reset/disconnect drops stale results so they cannot repopulate caches
or publish UI.

The approved status split uses shared `warning` styling for a missing current
animation and shared `danger` styling when a drawing exists for the animation
but its body is incompatible. Accessible cell labels and equipment UI Service
tips distinguish these reasons. Inventory item tips remain catalog-name-only,
without a slot prefix or status details; the remove choice keeps its unequip
action label. Drawing-layer conflicts remain `danger` plus the decorative
warning triangle on both implicated equipment cells, with conflict details in
accessible names and equipment tips; conflicts take precedence over availability
styling and still fail rendering. This adds no View-local CSS or guide changes.

Equipping still loads full sprite metadata only for selected items with
`WHERE item = ?`, and the first equip loads palettes for alternatives. Item and
sprite metadata queries use 512-row keyset pages ordered by `id`, adding
`AND id > ?` on subsequent pages; neither fetches image bytes.
Recolor controls appear only for the active equipped item, in the side panel
above its inventory. Names and ordering remain SQL-owned.
Slot activation never recomposes the character. Uncached inventories load
metadata and immediately show cells, then load demanded icons before compatibility
checks. A revisit is SQL-free only with cached inventory, demanded icons and their
current compatibility statuses; a new animation/body support key requires checks
after demanded icons are ready.
Image decoding remains capped at eight concurrent decoders. Reset invalidates
inventory, compatibility status, metadata, palette, pack, icon and render caches
and transient selections;
stale Reset/disconnect results cannot publish. Database records never change. Required
references and malformed state fail visibly; the View never creates or repairs
schema/data, reads catalog source folders or patches the Host at runtime. The producer owns
normalization and asset provenance; only SQLite records cross this boundary.
The deployable View remains one self-contained file. Availability adds no schema
or index changes. These changes do not alter the approved View-local CSS or
authorize a release.
