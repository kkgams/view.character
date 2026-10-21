# view.character — SQLite character browser

Pre-alpha equipment browser and transient character composer. It consumes a
supplied `catalog.sqlite`; it does not extract artwork or build databases.

## Supply the database

Place a compatible SQLite database at the filename configured by `gams.json`
(currently `catalog/catalog.sqlite`). The View does not need source files or
extraction tools. For local development, this checkout uses an ignored directory
symlink:

```text
catalog -> ../view.character.catalog1
```

Build from the independent catalog checkout:

```sh
cd ../view.character.catalog1
bash sources/lpc-rework.sh
make database
```

Close the Project/preview before rebuilding, then reopen it: replacing a database
file does not switch an open SQLite connection. The View's Reset reloads records
from its existing connection; it does not create or rebuild the database.
The code-only baseline intentionally contains no database. Generate one externally
or supply a compatible file at the configured path before launching.

### Native SQLite lock recovery

The current WASM SQL provider uses SQLite's `unix-dotfile` VFS, which locks with
an adjacent `<database>.lock` directory. An interrupted process can leave this
behind; subsequent queries report `database is locked` even when the database
itself is healthy. The browser preview uses a different SQLite VFS and does not
exercise this native locking path.

Do not remove a lock while any GAMS instance might still use that database.
After stopping all instances and any `make run` watcher, an empty stale lock for
the configured catalog can be removed manually:

```sh
rmdir catalog/catalog.sqlite.lock
```

Then reopen the Project. `rmdir` refuses nonempty directories; do not replace it
with recursive deletion. The View never removes locks or repairs database files.

## Open in GAMS or preview

Requires Node.js 24+, Python 3 and Make; no npm install. Native launch/download
commands below target macOS Apple Silicon. The preview additionally needs the
canonical sibling Host/theme checkouts (`GAMS_ROOT` and `THEME_ROOT` override).

```sh
make tools/gams.app  # download released Host; retain an existing app
make run-app
# or:
make run            # sibling development Host through Nix
make preview        # http://127.0.0.1:8820/
```

This intentionally requires the new Host API
`WidgetAnimationPreview.setClipAsync(value, isCurrent): Promise<boolean>`.
The existing clip API remains unchanged for other consumers. Update/rebuild the
sibling Host before using this View; an older downloaded Host without the new
method must fail visibly, not fall back to synchronous clip installation.

`gams.json` registers SQL v0.2.0, the98 theme and shell UI Services. Missing Units
are installed by the Host; first installation needs network. The downloader does
not independently verify release checksums or bypass Gatekeeper. The preview
serves canonical Host/theme code and real SQLite transport, with stubbed runtime
and Area chrome. It does not verify native Tauri/plugin startup.

To preview a different supplied database without changing Project configuration:

```sh
python3 scripts/preview.py --port 8831 --database /path/to/catalog.sqlite
```

## Runtime and controls

- **C1 — Equipment:** accessible icon grids; arrows and Home/End move focus,
  Enter/Space select, Tab exits. Every slot can unequip; the header's **Clear all
  slots** button unequips everything without reloading the catalog or clearing search.
  Startup and Reset leave all equipment slots empty. Names use UI Service tips.
- **C2 — Appearance:** activate a slot to load item metadata and immediately show
  cells, then demanded icons, then current animation/body compatibility warnings.
  Animation changes refresh support in place, retaining nodes, search, focus and
  icons. Equip to load only that item's full sprite metadata and, on first equip,
  palettes. Recolor only the active equipped item using the aside above the inventory (hidden when empty). Facing and 1×–4×
  zoom remain available. Indexed defaults retain each sprite's original palette; GPL alternatives need
  equal index counts. RGBA sprites are not recolored.
- **C3 — Playback:** SQLite animations supply `id, name`. Temporary explicit
  `animationSettings` at the top of the View supplies geometry, directions,
  sequence and timing: 100ms frames, idle 400ms, climb/hurt S only (otherwise
  NESW). Unsupported animation IDs fail; unsupported equipped parts are omitted
  with warnings, without invented frames or automatic Idle substitutions.
- **C4 — Reload:** Reset clears all caches and transient selections, then queries
  only slots and animations without changing database records. No slot is active;
  inventories and palettes stay unloaded until needed. Selection is not saved.

The single deployable file is `src/views/view-character.js`, using only Host-owned
`/core`, `/util` and `/widgets` imports. It never reads source artwork, mutates
the database or patches the Host at runtime. SQL result order is authoritative; slots use
`ORDER BY "order", id` with no order-value validation.

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

Compatibility queries return only item `id` and `supported` flags for selected
opaque item IDs in batches of at most 10, not 512-row keyset support pages.
Use a set-based `LEFT JOIN` from `items` to derived `SELECT DISTINCT item`
drawing IDs from `sprites`, filtered by `animation = ? AND mask = 0 AND instr(body, ?) > 0`
and the same at-most-10 item IDs. Restrict the outer items to the slot and those
IDs as well; a matching drawing row means supported. No per-item correlated
support query, full sprite metadata or BLOBs are loaded for compatibility.
Update cell warnings in place after each batch and yield before the next batch.

Cache partial support flags per slot/animation/body until Reset and reuse cached
flags. Missing flags in an incomplete map are pending/unknown, not unsupported;
a missing item in a completed support map is an invariant violation.
Changing search can add icon demand, pausing compatibility checks until those
icons are fetched, decoded and published and a paint yield allows checks to
restart. Slot or animation changes cancel obsolete queued compatibility work.
Animation changes retain inventory nodes, search, focus and decoded icons.
Only current results may update the active UI; stale slot or animation/body
results must not publish warnings. Reset/disconnect drops stale results so they
cannot repopulate caches or publish UI. Existing missing-animation warning
styling, accessible names and UI Service tooltips remain shared and unchanged.

Equipping still loads full sprite metadata only for the selected item, without
BLOBs, using `WHERE item = ? ORDER BY id LIMIT 512`, then
`WHERE item = ? AND id > ? ORDER BY id LIMIT 512`. The first equip also loads
the full palettes table for alternatives. Inventories, support flags, item sprite
metadata and palettes are cached until Reset; Reset also invalidates pack, icon
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
`BODY_SLOT_ID = "body-z12"` sets `this.body` from its sprite metadata after loading;
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
[the runtime layer contract](docs/layers.md).

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
when inventory, demanded icons and all current inventory support flags are cached;
a new animation/body support key requires checks after demanded icons are ready.
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
yield at a paint boundary before composition, then compose one frame per yield.
The Host shared widget asynchronously validates/copies RGBA in bounded chunks.
Commit only a complete clip for the latest selection, atomically; never publish
partial frames. Rapid item changes, Reset entry and disconnect cancel stale work.
Pixel, mask, numeric layer-order and animation semantics remain unchanged.
No CSS or protected View-guide changes are part of this policy. Native
demand-loaded item-selection performance remains unverified; no latency
improvement is claimed here.

### Historical support query-plan benchmark

Under the previous 512-item support lookup policy, a read-only Python SQLite
probe measured about 3.5 seconds for correlated `EXISTS … LIMIT 1`, versus about
31 ms for the set-based `LEFT JOIN` against distinct supported sprite item IDs.
This historical comparison does not measure the current at-most-10-ID
compatibility batches or data → icons → compatibility flow. It excludes native
Host/IPC/rendering costs and makes no claim about current latency. No schema or
index changes are part of the compatibility policy.

### Historical demand-loading preview validation

These measurements predate the pre-equip support query policy.

With the supplied 4,296-item / 78,295-sprite catalog, three warm browser-preview
reloads issued exactly two queries (slots and animations) and rendered in
9–20 ms, versus 1.39–1.55 seconds for the previous eager path. Inventory and
palette caches stayed empty and no slot or recolor UI was selected. A body-slot
probe loaded eight item records without sprite metadata or palettes; equipping
one item then loaded only its metadata, the palettes and its exact selected pack.
These measurements exclude cold module/Host startup and are not native desktop
latency guarantees.

### Historical progressive inventory validation

Before demand loading, with metadata already loaded, a native development GAMS smoke test against the
supplied catalog (read-only immutable connection) switched to 569 headwear items:
all cells appeared in about 9 ms, the first new icons in 138 ms, and all icons in
1.48 seconds. Icon requests were sequential, at most 10 IDs each; the cached
inventory revisit issued no icon SQL. These are environment-specific inventory
measurements, not startup or demand-loaded selection latency guarantees.
Exact selected sprite-pack loading remains unchanged; metadata is now demand-loaded.

### Historical item-selection validation

Before demand loading, a cached-item native GAMS probe with 569 inventory entries measured a 15 ms
click handler and a selection paint opportunity at 28 ms, versus about 1.4 seconds
and 2.2 seconds respectively before this change. The complete preview arrived
about 0.4 seconds after the click; its atomic widget commit took about 1 ms.
Inventory cell identity, focus and immediate selection were retained. These are
environment-specific warm-cache measurements, not validation of native demand-loaded
selection performance or startup guarantees.

### Historical native startup regression baseline

These measurements predate progressive icons and demand-loaded metadata.
They describe the former eager metadata/startup path, not measurements or latency
promises for the current loading policy.
The freeze investigation found 61 startup sprite BLOB requests each scanning
roughly 78,000 records. Exact-key fetching measured 2.08 seconds for those 61
requests, including JIT, versus 130.76 seconds before. Before metadata paging,
native metadata loading reached 1.96 GB; paged metadata measured 182 MB peak
RSS, retaining the same 82,933 records. Metadata plus the indexed packs measured
7.67 seconds and 178 MB peak RSS in the native SQL replay. A live GAMS probe
completed the 569-item equipment inventory in about 1.9 seconds while its native
heartbeat stayed responsive. Query replays exclude GUI/IPC/image-decoding costs;
these are not packaged-app startup guarantees.

## Approved sizing exception

The user-approved `APPROVED_LAYOUT_CSS` inside the View shadow DOM sizes 64×64
cells, fixed equipment columns, a flexible scrolling preview, centered 32px
empty/remove icons and three inventory cells per row. A further approved exception adds 16px
warning triangles 2px from the top-right equipment-cell corner, using the theme's
warning color. Both slots involved in a drawing-layer conflict are marked;
cell accessible names and UI Service tooltips include the conflict details.
Missing-animation cells use shared `warning` styling; conflicting equipment cells
use `danger` styling, taking precedence over missing-animation warnings.
Badges clear on the next equipment/animation preview request, and the rendering
failure remains visible. Equipped sprites and toolbar icons retain shared sizing. All colors, fonts, borders, focus, selection and
states remain Host/theme-owned. **Additional View-specific CSS requires fresh
approval.** See `AGENTS.md` for the exact boundary.

## Checks, packaging and docs

```sh
npm test
make check
make check-webkit    # macOS; preview must be running
npm run package
make serve-docs
make validate-docs
make build-docs
```

Tests/checks require no artwork, database producer or prepared database.
Packaging follows template.view: strip `src/`, include LICENSE, NOTICE, README.md
and NOTES.md; omit unit.json, databases, artwork and build tools. The wiki uses
justgook/wiki v1.4.0. Version 0.0.0 is a tooling placeholder, not a release.
No production asset-license approval, publisher or native packaged-app smoke test
is claimed. The broader `CHARACTER_STUDIO_AGENT_SPEC.md` remains design history,
not scope for a persistent editor.
