---
title: Character prototype
status: in-progress
---

# Character prototype

`view-character` consumes a supplied SQLite database through Host `/util/sql.js`.
Reload/Reset queries metadata during reload in bounded pages; sprite BLOBs
fetch/decode lazily per selected pack. Item and sprite metadata use 512-row SQL keyset pages ordered by `id`, with
`WHERE id > ?` on subsequent pages, bounding native WIT/JSON response memory.
Other tables load in full. Names and ordering remain SQL-owned. It does not extract artwork, mutate schema/data, read source files or change
the Host. The deployable View remains one self-contained file.

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

Equipment slot activation performs no SQL or character recomposition. Image
decoding remains capped at eight concurrent decoders.
Every slot may unequip. Initial selection uses its first item in SQL result order
when present. Icons browser-decode original supplied bytes, format and size,
without 32px, indexed or GPL assumptions. Indexed sprite PNGs preserve indices
and default to their original palette, not an assumed exact GPL match;
alternative recoloring requires equal index counts. Other browser-supported
formats retain original RGBA without fabricated palette indices or recoloring.
The [[layers|layer contract]] accepts any positive safe integer as numeric paint
order, with no fixed inventory. Masks target drawing buffers before flattening;
duplicate drawing occupancy remains an error. Approved CSS stays unchanged.

See the [README](https://github.com/kkgams/view.character#readme) for launch,
controls, checks and the approved View-local sizing exception. The loopback
preview uses canonical Host/theme code and real SQLite transport, with stubbed
runtime/chrome. Native packaged-app startup remains unverified.

`npm run package` contains View code only: no database, artwork or catalog build
tools. Version 0.0.0 is a local packaging placeholder, not release preparation.
