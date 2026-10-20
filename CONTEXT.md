# view.character

A pre-alpha SQLite catalog browser and transient character composer. The Host
owns runtime, SQL helpers, widgets, UI Services and theme styling. This repository
owns the single deployable View, local `gams.json`, preview and consumer tests.
It owns no source artwork, extraction, database-building schema or migrations.

## Database input

`gams.json` selects `catalog/catalog.sqlite`. Reload/Reset queries metadata during
reload in bounded pages through Host `/util/sql.js` and invalidates pack, icon
and render caches. Initial queries are metadata-first: items select only
`id, name, slot, palette`, without icon BLOBs or other image bytes. Item and sprite metadata retain 512-row
SQL keyset pages ordered by `id`, with `WHERE id > ?` on subsequent pages,
bounding native WIT/JSON response memory.
Other tables load in full. Names and ordering remain SQL-owned.
Sprite BLOBs are fetched/decoded lazily per selected pack. There are no schema/data
writes, FS access or source fallbacks. SQL result ordering is the
sole authority; slots use `ORDER BY "order", id` without order-value validation.
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
equipped parts are omitted with warnings, never fabricated frames.

`selectAnimationPack(item, state, database = sql)` selects from SQL-ordered cached
`item.sheets` metadata: first body compatible with `state.body`, then every
drawing/mask row with that exact body value. It fetches raw sprite BLOB rows by
bound exact opaque primary-key IDs, using
`WHERE item = ? AND animation = ? AND body = ? AND id IN (...) ORDER BY id`
in chunks of at most 256 IDs. Missing or changed returned pack IDs fail loudly
and require Reset. Character body is temporarily `m`; never parse sprite ID
suffixes. Later body/pack policy changes belong only in `selectAnimationPack`,
with its signature unchanged.

Icons load progressively for the current inventory, prioritizing the initially
selected equipment icons too. Each request uses
`SELECT id, icon FROM items WHERE id IN (...) ORDER BY id` with at most 10 bound
item IDs. Render each completed batch, then yield before requesting the next.
Cache fetched/decoded icons; do not eagerly load every inventory. Switching slots
cancels queued work for the old inventory. Reset/disconnect invalidates stale
in-flight results so they cannot repopulate caches or update the current cells.
Loading placeholders retain current cell accessible names, shared grid behavior
and Host/theme styling; no additional View-local CSS is authorized.

Equipment slot activation changes the active inventory without character
recomposition. Uncached slots request icon SQL; fully cached slots remain
SQL-free. Image decoding remains capped at eight concurrent decoders.
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
rebuild the full inventory or equipment board.

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

Selections are transient. Every slot may unequip; initial selection is the first
item in SQL result order per nonempty slot. Reload/Reset resets transient state.
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
