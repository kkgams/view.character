---
title: Runtime and database contract
status: reference
---

# Runtime and database contract

## Runtime and controls

- **C1 — Equipment:** accessible icon grids; arrows and Home/End move focus,
  Enter/Space select, Tab exits. Every slot can unequip; the header's **Clear all
  slots** button unequips everything without reloading the catalog or clearing search.
  Startup and Reset leave all equipment slots empty. Names use UI Service tips.
- **C2 — Appearance:** activate a slot to load item metadata and immediately show
  cells, then demanded icons, then current animation/body compatibility warnings.
  Animation changes refresh support in place, retaining nodes, search, focus and
  icons. Equip to load only that item's full sprite metadata and, on first equip,
  palettes. Recolor only the active equipped item using the aside above the inventory (hidden when empty). Facing and viewport zoom remain available. Indexed defaults retain each sprite's original palette; GPL alternatives need
  equal index counts. RGBA sprites are not recolored.
- **C3 — Playback:** the sidebar’s Animation section groups animation selection,
  Facing direction and playback. SQLite animations supply `id, name`. Temporary explicit
  `animationSettings` at the top of the View supplies geometry, directions,
  sequence and timing: 100ms frames, idle 400ms, climb/hurt S only (otherwise
  NESW). Unsupported animation IDs fail; unsupported equipped parts are omitted
  with reason-specific warning/danger states, without invented frames or automatic
  Idle substitutions.
- **Spritesheet mode:** use the Animation / Spritesheet radios above the sidebar
  controls. Animation retains the existing playback UI. Spritesheet replaces it
  with a checkbox for every catalog animation; the first animation starts checked.
  **Select all** checks or clears the entire list; partial selection shows a mixed
  checkbox state. Checked sheets render in catalog order, stacked vertically and
  left-aligned on the same pan/zoom/fit canvas. The canvas base receives the widest
  selected sheet's width and the sum of their heights as the completed bounding
  box; changes in output dimensions automatically refit, while same-size equipment
  or color changes preserve manual pan/zoom. Each includes every source column and all facing
  rows (not the playback sequence), using current equipment, masks and colors.
  Unavailable parts are omitted per animation; unavailable sheets retain transparent
  space, and no selections or no supported equipment clears the canvas. Sheet
  selection persists across mode switches, not Reset. Rendering stays asynchronous
  and publishes one complete static image; obsolete work cannot publish. Inventory
  compatibility hints continue to refer to the last selected playback animation.
  No new View-local CSS or catalog/schema dependencies are added.
- **C4 — Reload:** Reset clears all caches and transient selections, then queries
  only slots and animations without changing database records. No slot is active;
  inventories and palettes stay unloaded until needed. Selection is not saved.

The single deployable file is `src/views/view-character.js`, using only Host-owned
`/core`, `/util` and `/widgets` imports. It never reads source artwork, mutates
the database or patches the Host at runtime. SQL result order is authoritative; slots use
`ORDER BY "order", id` with no order-value validation.

Slots referenced by SQLite `"item-slots" (item, slot)` are conditional: show them
only while at least one linked item is equipped in a visible slot. Unreferenced
slots are always visible. Resolve nested dependencies from those unconditional
roots; retained hidden equipment cannot unlock descendants or dependency cycles.
The slots query also returns linked opaque item IDs as JSON, keeping startup and
Reset at two queries without loading inventories or sprite metadata. The table is
required; a missing table fails visibly, without schema repair.
Hiding a slot retains its equipped item and color, but excludes it from preview
composition, pack loading and availability until it reappears. If the active slot
becomes hidden, clear its picker and cancel queued compatibility work. Ordinary
item activation keeps inventory nodes, focus and search; rebuild the equipment
board only when visibility or parent placement changes. Clear and Reset remove even hidden equipment.
Randomize demands visible inventories, following newly unlocked slots without
loading inaccessible ones. No additional View-local CSS is introduced.

Related equipment slots form horizontal groups with their parent instead of
occupying root rows. Unconditional slots keep their two outer columns and row
positions; left groups extend right and right groups extend left into the preview
space. Siblings retain SQL `ORDER BY "order", id`, smallest nearest the parent;
nested branches follow their parent depth-first. A slot linked to multiple equipped
parents is shown once, assigned to the first reachable parent in breadth-first
catalog order. Parent reassignment also refreshes the board, even if visibility
is unchanged. Fixed 64px side-column spans reuse the existing approved sizing;
the empty central rowspan remains over the canvas. No CSS is added.

Startup and Reset still issue exactly two queries: slots and animations through
Host `/util/sql.js`.
All equipment is empty and `selectedSlot` is `null`; no inventories, sprite
metadata or palettes load, and no palette UI is shown.

Activating a slot first loads its inventory metadata: select `id, name, slot, palette, category`
without image bytes using `WHERE slot = ? ORDER BY id LIMIT 512`, then
`WHERE slot = ? AND id > ? ORDER BY id LIMIT 512` for subsequent pages.
The nullable text `items.category` groups the active slot's filtered inventory.
Each nonempty category has a static full-width heading (`colspan="3"`), followed
by three-column item rows. Categories follow first appearance in SQL ID order;
items retain that order within each group. NULL/empty categories appear last,
without a heading. The remove choice stays first in its own row. Search omits
empty groups. Category labels are literal text, not HTML; no local CSS is added.
A missing category column or non-text/non-NULL value fails visibly.
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
tips distinguish these reasons. Inventory item tips show the catalog name and item ID,
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

`selectAnimationPack(item, state, database = sql)` selects from SQL-ordered cached
`item.sheets` metadata: first body compatible with `state.body`, then every
drawing/mask row with that exact body value. It fetches raw sprite BLOB rows by
bound exact opaque primary-key IDs, using
`WHERE item = ? AND animation = ? AND body = ? AND id IN (...) ORDER BY id`
in chunks of at most 256 IDs. Missing or changed returned pack IDs fail loudly
and require Reset. `DEFAULT_BODY_TYPE = "m"` initializes character body. Equipping an item in
`BODY_SLOT_ID = "body"` sets `this.body` from its sprite metadata after loading;
assert exactly one valid body code across all its animations. Never parse sprite
ID suffixes. This first step leaves unequipping/Clear body-mode behavior unchanged
(the last mode remains until Reset).
Availability checks for `BODY_SLOT_ID` require a drawing for the selected animation
but ignore the current character body, both in batched SQL and loaded metadata.
This lets users select a different shape. All other slots still match `this.body`;
missing animations and mask-only rows remain unsupported. Later body/pack policy changes belong only in `selectAnimationPack`,
with its signature unchanged.

Image decoding remains capped at eight concurrent decoders. Icons browser-decode supplied
bytes in their original format and size, without 32px, indexed or GPL assumptions.
Sprite BLOBs preserve indexed PNG indices (including duplicate RGB roles); other
browser-supported formats retain original RGBA, never fabricated indices or
recoloring. Indexed defaults do not require an exact GPL match.

Layers are any positive safe integers in numeric paint order, not a fixed
inventory. Masks erase target drawing buffers before flattening; duplicate drawing
occupancy remains an error. These user-approved runtime changes supersede earlier
database-required animation and indexed-only expectations. See
[[layers|the runtime layer contract]].

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
Slot changes preserve active playback. Unchanged compositions reuse clips;
resizing does not recompose frames. Empty inventories distinguish absent catalog
items from searches with no matches. Provenance belongs to the supplied catalog,
not hardcoded View-specific author or source warnings.

### Responsive item selection and atomic preview

Inventory item activation immediately updates `parts`/`colors` and
`aria-selected` in the existing inventory DOM, retaining focus and search state.
Update only the changed equipment cell and selected palette controls; do not
rebuild the full inventory or equipment board. Recolor controls apply only to
the active slot's equipped item, in an aside above the inventory; hide them
when that slot is empty or no slot is active. No CSS changes are authorized.

While a replacement is pending, retain the old complete preview clip and show
“Rendering character preview…” in the footer and a centered, indeterminate
`ui.toast` progress notification (`position: "modal"`). The same toast transitions
to success (600ms) or error (3 seconds). A replacement selection, Reset, or
disconnect closes obsolete progress, including late-arriving toast IDs; dismissing
a toast does not cancel rendering. The configured toast service must implement
the progress lifecycle API. The browser preview serves the canonical sibling
`ui-service.toast` implementation (`--toast` overrides its checkout path). Selected-pack SQL loading is already asynchronous;
yield at a paint boundary before composition, then compose offscreen frame
canvases one per task yield. The View stores the complete clip as
`this.previewClip = { width, height, frames: [{ canvas, durationMs }] }` and
publishes it atomically only for the latest request; never publish partial frames.
Rapid item changes, Reset entry and disconnect cancel stale work. The View owns
looping `setTimeout` playback and pauses it on disconnect and Reset. The current
complete clip remains visible until its replacement is ready.
Pixel, mask, numeric layer-order and animation semantics remain unchanged.

Viewport pan, zoom and fit redraw the completed clip without recomposition.
Preview frames retain native sprite dimensions; zoom and fit are viewport-only.
Shared Host `base.css` overlaps adjacent main-form canvas/table children, including
shadow-root forms: the canvas fills the viewport beneath the table and stays in
place while oversized equipment scrolls. The central `rowspan` cell remains empty.
The stacked table passes pointer input to the canvas except at `[aria-selected]`
elements. Transparency remains pending; no View-local CSS is added.

Native demand-loaded item-selection performance remains unverified; no latency
improvement is claimed here.


## Approved sizing exception

The user-approved `APPROVED_LAYOUT_CSS` inside the View shadow DOM sizes 64×64
cells, fixed equipment columns, centered 32px
empty/remove icons and three inventory cells per row. A further approved exception adds 16px
warning triangles 2px from the top-right equipment-cell corner, using the theme's
warning color. Both slots involved in a drawing-layer conflict are marked;
cell accessible names and UI Service tooltips include the conflict details.
Missing-current-animation cells use shared `warning` styling; cells with a drawing
for that animation but an incompatible body use shared `danger` styling.
Conflicting equipment cells retain `danger` plus the warning triangle, taking
precedence over availability styling. Accessible labels and equipment tips
distinguish the reasons; inventory tips show the catalog name and item ID.
Badges clear on the next equipment/animation preview request, and the rendering
failure remains visible. Equipped sprites and toolbar icons retain shared sizing. All colors, fonts, borders, focus, selection and
states remain Host/theme-owned. **Additional View-specific CSS requires fresh
approval.** The canvas migration removes the legacy central-widget sizing/scroll
rules only; it adds no CSS and leaves the central table cell empty.


### Native SQLite lock recovery

The current WASM SQL provider uses SQLite's `unix-dotfile` VFS, which locks with
an adjacent `<database>.lock` directory. An interrupted process can leave this
behind; subsequent queries report `database is locked` even when the database
itself is healthy. The browser preview uses a different SQLite VFS and does not
exercise this native locking path.

Do not remove a lock while any GAMS instance might still use that database.
After stopping all instances and any development Host watcher, an empty stale lock for
the configured catalog can be removed manually:

```sh
rmdir catalog/catalog.sqlite.lock
```

Then reopen the Project. `rmdir` refuses nonempty directories; do not replace it
with recursive deletion. The View never removes locks or repairs database files.

