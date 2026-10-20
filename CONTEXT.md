# view.character

A pre-alpha SQLite catalog browser and transient character composer. The Host
owns runtime, SQL helpers, widgets, UI Services and theme styling. This repository
owns the single deployable View, local `gams.json`, preview and consumer tests.
It owns no source artwork, extraction, database-building schema or migrations.

## Database input

`gams.json` selects `catalog/catalog.sqlite`. Reload/Reset queries metadata during
reload in bounded pages through Host `/util/sql.js` and invalidates pack, icon
and render caches. Item and sprite metadata use 512-row SQL keyset pages ordered by `id`, with
`WHERE id > ?` on subsequent pages, bounding native WIT/JSON response memory.
Other tables load in full. Names and ordering remain SQL-owned.
Sprite
BLOBs are fetched/decoded lazily per selected pack. There are no schema/data
writes, FS access, source fallbacks or Host changes. SQL result ordering is the
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

Equipment slot activation changes the active inventory slot without SQL or
character recomposition. Image decoding remains capped at eight concurrent decoders.
Icons browser-decode original supplied bytes, format and size, without 32px,
indexed or GPL assumptions. Indexed sprite PNGs preserve indices, including
duplicate RGB roles; other browser-supported formats retain original RGBA, with
no fabricated palette indices or recoloring. Indexed defaults use original sprite
palettes, without assuming exact GPL matches. GPL alternatives require equal
index counts. GPL names and ordered entries remain catalog-owned.

Layers accept any positive safe integer as numeric paint order, not a fixed
inventory. Masks operate on target drawing buffers before flattening; duplicate
drawing occupancy remains an error. See `docs/layers.md`.

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
