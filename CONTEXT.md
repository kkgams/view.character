# view.character

A pre-alpha SQLite catalog browser and transient character composer. The Host
owns runtime, SQL helpers, widgets, UI Services and theme styling. This repository
owns the single deployable View, local `gams.json`, preview and consumer tests.
It owns no source artwork, extraction, database-building schema or migrations.

## Database input

`gams.json` selects `catalog/catalog.sqlite`. Reload/Reset rereads its slots, items,
icon/sprite BLOBs, GPL palettes and normalized animations through Host
`/util/sql.js`, without schema/data writes, FS access or source fallbacks.
The local ignored symlink may point to any externally built compatible catalog;
the producer's source structure and tools are not View dependencies.

The ignored local `catalog` directory symlink targets the sibling
`view.character.catalog1` checkout. Only its `catalog.sqlite` crosses the runtime
boundary; this is development wiring, not an import or build dependency. A regular
supplied database at the configured path works without that repository. The
code-only baseline contains no database. Close/reopen the Project or preview after
external atomic database replacement.

## Runtime contract

Indexed PNGs preserve indices, even for duplicate RGB roles. GPL text supplies
palette names and ordered visible entries; transparent index 0 is implicit.
Animations explicitly define NESW frame geometry, sequence and durations.
Unsupported equipped parts are omitted with warnings, never fabricated frames.
Masks operate on their target buffers before numeric-layer flattening; conflicting
drawing occupancy fails. See `docs/layers.md` for the consumer contract.

Selections are transient. Every slot may unequip, initial selection is the first
stable item ID per nonempty slot, and palette alternatives have equal index
counts. Reload/Reset clears decoded/render caches and resets transient state.
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
