---
title: Character prototype
status: in-progress
---

# Character prototype

`view-character` consumes a supplied SQLite database through Host `/util/sql.js`.
Reload/Reset queries metadata during reload in bounded pages; sprite BLOBs
fetch/decode lazily per selected pack. Initial queries are metadata-first: items
select only `id, name, slot, palette`, without icon BLOBs or other image bytes. Item and sprite metadata retain 512-row
SQL keyset pages ordered by `id`, with `WHERE id > ?` on subsequent pages,
bounding native WIT/JSON response memory.
Other tables load in full. Names and ordering remain SQL-owned. It does not
extract artwork, mutate schema/data, read source files or patch the Host at
runtime. The deployable View remains one self-contained file.

SQL result ordering is authoritative: slots use `ORDER BY "order", id` with no
order-value validation. SQLite animations supply `id, name`; temporary explicit
`animationSettings` at the top of the View provides geometry, directions, sequence
and timing (100ms frames, idle 400ms, climb/hurt S only; otherwise NESW).
Unsupported animation IDs fail; unsupported equipped parts are omitted with
warnings. This user-approved runtime policy supersedes prior database-required
animation and indexed-only expectations.

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
Every slot may unequip. Initial selection uses its first item in SQL result order
when present. Icons browser-decode original supplied bytes, format and size,
without 32px, indexed or GPL assumptions. Indexed sprite PNGs preserve indices
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
rebuild the full inventory or equipment board.

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
No CSS or protected View-guide changes are part of this policy. Post-change
item-selection performance measurements remain pending.

See the [README](https://github.com/kkgams/view.character#readme) for launch,
controls, checks and the approved View-local sizing exception. The loopback
preview uses canonical Host/theme code and real SQLite transport, with stubbed
runtime/chrome. Native packaged-app startup remains unverified.

`npm run package` contains View code only: no database, artwork or catalog build
tools. Version 0.0.0 is a local packaging placeholder, not release preparation.
