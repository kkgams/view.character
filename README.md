# view.character — SQLite character browser

Pre-alpha equipment browser backed by a prepared SQLite catalog. The initial
catalog contains one indexed body item and Walk animation; remaining slots are
empty. This is not a production character editor or asset importer.

## Runtime contract

The View is a single deployable file: `src/views/view-character.js`. Every View reload/Reset queries slots, items,
icon/sprite PNG BLOBs, GPL palettes and animations through the shared Host
`/util/sql.js` connection. It clears decoded/render caches and resets transient
selections without writing schema/data or reading files through FS. There are no
runtime mock/motion catalogs or cached fixture fallbacks.

Slot selection updates only selection and inventory, preserving the active preview
and playback. Unchanged compositions reuse the existing clip; window resizing
does not compose or serialize animation frames. Clips use the zoomed sprite width
instead of viewport-wide transparent pixel buffers. Empty inventory messages
distinguish slots with no catalog items from searches with no matches.

The helper parses GPL and decompresses indexed PNGs without reconstructing indexes
from RGB: duplicate RGB entries retain distinct indexes. It validates references,
NESW geometry, timing and binary masks. Drawings use separate numeric-layer
buffers; masks erase only their targets before layers are flattened in order.
See [the layer contract](docs/layers.md).

Each slot initially selects its first item by stable ID, if any; every slot may
be unequipped, including body/head. Palette rows appear only for slots containing
items. Each item defaults to its own palette; alternatives have the same palette
index count. SQLite GPL names label palettes; colors do not imply materials.
Animation geometry, sequence and timing come only from SQLite, with fixed NESW
four-direction sheets. Other raw clips and held poses are not automatically
adopted. Catalog information is generic; provenance remains in prepared inputs
and generated docs, not a SQL author schema.

## Prepare the database offline

Requires Node.js 24+, Python 3 (stdlib), Make, curl and tar; no npm install.
Aseprite is required for offline fixture preparation and generated GIFs, not
View/preview startup.

```sh
make animation-fixtures
make fixtures ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite
make catalog-fixtures
make database ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite
```

`make catalog-fixtures` prepares one lossless indexed body Walk sample from pinned
originals, reorders NWSE rows to NESW and extracts a centered 32×32 icon. A single
palette covers the icon and sheets: transparent index 0, visible colors 1..N.
Partial alpha and more than 255 visible colors fail instead of quantizing.
Changed prepared inputs are never overwritten. Credits, source hashes, licenses
and modification notices accompany the derived sample.

`make database` imports existing `CATALOG` (default `catalog/`) using
`scripts/catalog.sql`, then generates [Project animations](docs/animations.md)
and credited, native-size south-facing GIFs through Aseprite. It never reruns
preparation or downloads assets. Folder JSON is authoritative after preparation;
`scripts/catalog-sample/` holds bootstrap JSON. Failed import/render validation
preserves previous outputs. Documentation currently requires exactly one reference
item; the builder API can import multiple items without documentation.

Close the Project/preview before rebuilding and reopen afterward: atomic file
replacement does not switch an open SQLite connection. Rebuild replaces the whole
database and discards manual edits; View reload/Reset instead rereads the existing
catalog and preserves database edits. An alternate `DATABASE` filename must also
be configured in `gams.json` (`sql`).

The schema contains `slots`, `palettes`, `items`, `animations` and `sprites`, with
foreign-key references and no layer table, migrations or history. GPL text is
stored unchanged; PNG BLOBs preserve indexes. Character selections are not saved.
Use `view.sql` to inspect/edit catalog records; production read-only enforcement
is separate work.

## Open in GAMS or preview

After building the database:

```sh
make tools/gams.app  # download released Host, macOS Apple Silicon
make run-app
# or: make run       # sibling development Host; GAMS_ROOT overrides
make preview         # http://127.0.0.1:8820/
```

`gams.json` registers standard `plugin.sql` v0.2.0, all six shell UI Services and
the98 theme. The Host installs missing Units into ignored `gams_modules/`;
first installation needs network. Host widgets, `/util/sql.js`, grid helpers,
fonts and theme styles are canonical shared sources, not vendored copies.
Downloaded apps must contain the required helpers and Game Icons CSS/font.
The downloader retains an existing app, does not independently verify release
checksums and does not bypass Gatekeeper.

The loopback preview serves the single View file and canonical sibling Host/theme
sources, including the tooltip service. Its thin SQL transport executes real
Python SQLite queries against the configured database; it has no FS routes or
fixture startup requirements. Runtime/chrome are stubbed; this does not exercise
Tauri, native plugin loading or the real layout service. Override `PORT`,
`GAMS_ROOT` or `THEME_ROOT` as needed. For an isolated database:

```sh
make database DATABASE=/tmp/character-preview.sqlite
python3 scripts/preview.py --port 8831 --database /tmp/character-preview.sqlite
```

## Controls

- Equipment and inventory use accessible, icon-only selectable grids. Arrows,
  Home/End move focus; Enter/Space select; Tab exits. Names use UI Service tips.
- Search items, equip or unequip any slot, change palettes, facing and 1×–4× zoom.
- Select a database animation and Play. Unsupported parts remain equipped and
  interactive with shared danger intent and an omission warning; no invented
  frames or Idle fallback. Randomize changes selections; Reset reloads the catalog.
- Catalog information opens generic scope guidance; no hardcoded facial-hair
  warning is shown for items absent from the imported catalog.

### User-approved sizing exception

The user explicitly approved `APPROVED_LAYOUT_CSS` in `src/views/view-character.js`, inside the
View's shadow DOM only, for equipment/inventory cell dimensions and the preview
viewport, plus a subsequent user-approved addition for **32px centered empty-slot
and inventory remove icons**, and then **three square inventory cells per row**.
Inventory uses explicit 64px dimensions; the ineffective `aspect-ratio` rule was
removed. Equipped sprites and toolbar icons are unchanged.
**Any additional View-specific CSS requires fresh user approval.**
This is not a generic Host sizing API and does not extend shared Host/theme CSS
or the protected View guide. See [`AGENTS.md`](AGENTS.md) for the exact boundary.
Canonical Host reset/base and the active theme are still loaded into the shadow
root; theme href changes are mirrored through the existing Host theme helper.
All colors, font families, borders, selection, focus and disabled styles remain shared.

## Independent LPC animation research

`assets/lpc/animations.json` catalogs the original/legacy unified, Revised,
Expanded, modern Universal and selected independent community layouts without
changing the runtime registry. Read **LPC Animation Reference** in `CONTEXT.md`,
`assets/lpc/README.md` and `assets/lpc/ATTRIBUTION.md` for ordering, coordinate
conventions, pinned sources, licenses and explicit unknowns.

```sh
python3 scripts/validate_lpc_animations.py  # offline asset/metadata checks
python3 scripts/fetch_lpc_catalog.py       # restore missing pinned research files only
```

The original artwork and research evidence are outside `src/`, excluded from the
code-only package, and not production imports. This snapshot is bounded by the
researched sources, not a claim to inventory every community submission.

## Offline sources and research

Existing raw fixtures remain offline development inputs. The View does not read
their mock/motion catalogs. The historical facial-hair licensing limitations below
still apply to those sources; those items are not automatically imported.

### Development fixture repositories

These are offline preparation/research inputs, not View startup dependencies.
Before artwork/animation/conversion work, prepare the registered source fixtures:

```sh
make fixture-repos              # all registered pinned upstream checkouts
make animation-fixtures        # current Project's pinned body/head sources
make fixtures ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite  # offline legacy visual mock
make check-fixture-repos        # offline origin/revision/clean-worktree verification
```

On other systems use the installed Aseprite executable for `ASEPRITE`.
The full Universal LPC checkout is under ignored
`fixtures/repos/universal-lpc-generator` (roughly 500 MB locally), pinned to
`9bf06be193b053db256b2536824af426de046aa2`. No npm install or upstream build is run.
Existing checkouts are verified, never automatically pulled/reset or overwritten.
Preserve local experiments and update pins deliberately.

The additional `kyuza1/lpc-character-mcp` checkout lives at ignored
`fixtures/repos/lpc-character-mcp`, pinned to
`34d3788d309dc5df8f99c1420951d9dc53d30df6`. It is a source/reference fixture only;
no setup, dependencies or MCP server are installed/started. Its MIT code license
does not cover separately licensed LPC artwork downloaded by the upstream tool.
To prepare just this checkout:

```sh
python3 scripts/fetch_fixture_repositories.py --id lpc-character-mcp
```

The `kanishka-namdeo/lpc-spritesheet-mcp` source fixture is at ignored
`fixtures/repos/lpc-spritesheet-mcp`, pinned to
`560ebc28c48c539124364d9fa1d0b3087ea0a0c1`. Its code declares GPL-3.0-only;
external artwork is separately licensed. Nothing is installed, configured or
started. Prepare only this fixture with:

```sh
python3 scripts/fetch_fixture_repositories.py --id lpc-spritesheet-mcp
```

Track **every downloaded repository** in `scripts/fixture-repositories.json`:
URL, commit, clone/selected-file mode, local locations and associated source
manifests. It also records LPC-rework, ElizaWy/LPC, the original style guide and
legacy unified LPC as selected-file sources, not fictitious full clones.
File-level hashes, attribution and OGA download URLs remain in their linked
manifests. Register future sources before adding another downloader.

These are development-only fixtures, not submodules or vendored runtime code.
They remain excluded from the code-only package; fixture-free tests and packaging
must not start downloading them automatically.

### Legacy raw motion fixture preparation

`make fixtures` also prepares the motion data. To update that data alone:

```sh
make motion-fixtures
```

`scripts/lpc-motion-fixtures.json` pins 240 per-item/source mappings: 221 actual
raw PNGs and 19 explicit missing upstream files. The preparer restores ignored
`fixtures/lpc/motions/` and atomically writes `fixtures/lpc/motion-catalog.json`.
No modified source is overwritten, no quantization occurs, and existing per-item
licensing/attribution—including the facial-hair warning—remains unchanged.

Coverage is intentionally source-specific: boots, shorts and suspenders lack the
five combat/swing sheets; three facial-hair items and the bowtie lack Climb.
Eighteen Emotes item sheets have three columns, while default body/head have four.
Two helmet Climb sheets have four source rows; only their north row0 is used by
the north-only Project clip. Unsupported combinations are reported, not invented.
Unknown authored timing uses explicitly labeled reference-preview holds; these
are not mandatory gameplay timing or one-shot/loop semantics.

For isolated browser checks without touching the native Project's open database:

```sh
make database DATABASE=/tmp/character-preview.sqlite
python3 scripts/preview.py --port 8831 --database /tmp/character-preview.sqlite
# make check-webkit PORT=8831
```

The override is explicit and preview-only; it does not modify `gams.json`.

## Checks, packaging and docs

```sh
npm test                 # fixture-independent tests
make check               # additionally checks offline fixtures and sibling Host
make check-webkit         # macOS WKWebView checks; preview must be running
npm run package          # code-only ZIP and SHA256SUMS in dist/
make serve-docs          # localhost:8080; DOCS_PORT overrides
make validate-docs
make build-docs          # build/site/
```

These commands describe available checks, not validation results for this
revision. Browser checks use canonical Host SQL over the preview transport;
a native Tauri packaged-app smoke test remains unverified.

Packaging follows `template.view`: strip `src/`, include LICENSE, NOTICE,
README.md and NOTES.md, omit `unit.json`. Neither SQLite databases, SQL build
inputs nor LPC assets are bundled. Supply a prepared catalog separately.
Version `0.0.0` is a packaging placeholder; no release, publication, production
licensing approval or 1.0.0 preparation is claimed. The wiki uses pinned
justgook/wiki v1.4.0; GitHub Pages requires its GitHub Actions source setting.

Catalog creation, classification and asset CRUD remain outside this View.
`CHARACTER_STUDIO_AGENT_SPEC.md` is an earlier broader draft, not acceptance
criteria for persistent characters, recipes or a full editor.
