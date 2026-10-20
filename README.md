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
  Enter/Space select, Tab exits. Every slot can unequip. Initial selection uses
  the first item in SQL result order in each nonempty slot. Names use UI Service tips.
- **C2 — Appearance:** search/equip items, choose palettes, facing and 1×–4× zoom.
  Indexed defaults retain each sprite's original palette; GPL alternatives need
  equal index counts. RGBA sprites are not recolored.
- **C3 — Playback:** SQLite animations supply `id, name`. Temporary explicit
  `animationSettings` at the top of the View supplies geometry, directions,
  sequence and timing: 100ms frames, idle 400ms, climb/hurt S only (otherwise
  NESW). Unsupported animation IDs fail; unsupported equipped parts are omitted
  with warnings, without invented frames or automatic Idle substitutions.
- **C4 — Reload:** Reset queries metadata during reload in bounded pages, invalidates pack/icon/render
  caches and resets transient selections without changing database records.
  Sprite BLOBs load lazily per selected pack. Selection is not saved.

The single deployable file is `src/views/view-character.js`, using only Host-owned
`/core`, `/util` and `/widgets` imports. It never reads source artwork, mutates
the database or changes the Host. SQL result order is authoritative; slots use
`ORDER BY "order", id` with no order-value validation.

Item and sprite metadata use 512-row SQL keyset pages ordered by `id`, with
`WHERE id > ?` on subsequent pages, bounding native WIT/JSON response memory.
Other tables load in full. Names and ordering remain SQL-owned.

`selectAnimationPack(item, state, database = sql)` selects from SQL-ordered cached
`item.sheets` metadata: first body compatible with `state.body`, then every
drawing/mask row with that exact body value. It fetches raw sprite BLOB rows by
bound exact opaque primary-key IDs, using
`WHERE item = ? AND animation = ? AND body = ? AND id IN (...) ORDER BY id`
in chunks of at most 256 IDs. Missing or changed returned pack IDs fail loudly
and require Reset. Character body is temporarily `m`; never parse sprite ID
suffixes. Later body/pack policy changes belong only in `selectAnimationPack`,
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

Equipment slot activation changes the active inventory slot without SQL or
character recomposition. Slot changes preserve active playback. Unchanged compositions reuse clips;
resizing does not recompose frames. Empty inventories distinguish absent catalog
items from searches with no matches. Provenance belongs to the supplied catalog,
not hardcoded View-specific author or source warnings.

### Native startup regression

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
empty/remove icons and three inventory cells per row. Equipped sprites and toolbar
icons retain shared sizing. All colors, fonts, borders, focus, selection and
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
