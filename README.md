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
  the first stable item ID in each nonempty slot. Names use UI Service tips.
- **C2 — Appearance:** search/equip items, choose palettes, facing and 1×–4× zoom.
  Palette alternatives have equal index counts; defaults are item-defined.
- **C3 — Playback:** geometry, NESW directions, sequence and timing come only from
  SQLite. Unsupported equipped parts remain interactive but are omitted with
  warnings. There are no invented frames or automatic Idle substitutions.
- **C4 — Reload:** Reset rereads SQL, clears decoded/render caches and resets
  transient selections without changing database records. Selection is not saved.

The single deployable file is `src/views/view-character.js`, using only Host-owned
`/core`, `/util` and `/widgets` imports. It queries SQL on reload, never reads
source artwork or creates schema. Indexed PNG indices and duplicate RGB roles
are preserved. Masks erase their target buffers before layers are flattened.
See [the runtime layer contract](docs/layers.md).

Slot changes preserve active playback. Unchanged compositions reuse clips;
resizing does not recompose frames. Empty inventories distinguish absent catalog
items from searches with no matches. Provenance belongs to the supplied catalog,
not hardcoded View-specific author or source warnings.

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
