# view.character — LPC visual prototype

**Question:** does a compact, equipment-style character browser feel right before
we design the SQL read contract? Variant A is retained; B/C and the procedural
mannequin have been removed.

The View uses twenty real, pinned LPC Revised source layers across ten slots:
body, head, hair, top, legs, feet, headwear, facial hair, neckwear and outerwear.
The five-per-side board starts with a layered outfit: helmet, trimmed beard,
bowtie and suspenders over the original clothing. This is still a **throwaway
visual mock**, not an importer, database or asset editor.

The eight additions are two helmets, two beards, a mustache, a bowtie, suspenders
and a cardigan. Facial-hair attribution/license is **UNVERIFIED** in the upstream
per-item records: those ignored local fixtures are for visual testing, not
redistribution clearance. Other selected items have explicit OGA-BY 3.0 records.

## Template-aligned build and docs

Requires Node.js 24+, Python 3 (stdlib), Make, curl and tar; no npm install needed.
The existing prototype commands below remain available.

```sh
npm test                        # no LPC fixtures or sibling Host needed
npm run package                 # code-only ZIP and SHA256SUMS in dist/
make package                    # same packaging command
make serve-docs                 # http://localhost:8080
make serve-docs DOCS_PORT=3000   # separate from preview PORT (default 8820)
make validate-docs
make build-docs                 # portable wiki under build/site/
```

Canonical View code is `src/views/view-character.js`; both the Project and browser
harness load it directly. `scripts/catalog.sql` is the build-time database input,
not a View companion or runtime migration. Neither SQL build inputs nor generated
databases are bundled in the code-only archive.

Packaging follows `template.view`: strip `src/`, include LICENSE, NOTICE,
README.md and NOTES.md, and omit `unit.json`. Version `0.0.0` is a local tooling
placeholder, not a production release. The code-only archive contains no LPC
fixtures and cannot render this prototype without separately prepared local
assets. It is intended for manual prototype use, not deployment clearance.
No `1.0.0` version, release publisher, tag or publication is prepared here.
CI runs fixture-independent checks, docs validation and packaging only. GitHub
Pages can serve the wiki after **Settings → Pages → Source → GitHub Actions** is
enabled. The wiki engine is pinned to justgook/wiki v1.4.0 and cached in `build/`.

## Open in GAMS

Download a released Host locally, as in `example.game3` (macOS Apple Silicon):

```sh
make animation-fixtures
make database ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite
make tools/gams.app
make run-app
```

The download uses the official GitHub latest-release API and retains an existing
app without updating it. Additional release documents remain under ignored
`tools/gams-release-notices/`. It does not independently verify release checksums
or bypass Gatekeeper. Alternatively, select this directory as a Project in a
compatible GAMS Host, or run the sibling development Host:

```sh
make run
```

Override `GAMS_ROOT` if necessary. `gams.json` uses local `src/views/view-character.js`, pinned FS and
layout plugins, all six shell UI Services, and the98 theme. The Host installs
missing Units into ignored `gams_modules/`; first installation needs network.
Once fixtures are prepared, normal loading needs no upstream asset download or Aseprite installation.
The Project also registers the published standard SQL provider (`plugin.sql`
v0.2.0, not sql-vec). The visual fixture renderer still uses its existing JSON
fixture; SQL is configured for the next catalog slice, not wired into rendering.

The Host supplies `/widgets/animation-preview.js`, `/util/view-plugin.js`,
`/util/selectable-grid.js`, `/core/runtime.js` and their dependencies; they are
not vendored here. Use a Host containing the grid helper and Game Icons font/CSS
(the installed 2.0.7 bundle or updated sibling source). Older downloaded apps do
not acquire these files automatically. Native startup is still a separate smoke
check; the browser harness uses the canonical sibling Host/theme sources.

## Build a local SQLite database

```sh
make animation-fixtures                   # fetch 12 pinned body/head animation pairs
make database ASEPRITE=aseprite            # SQLite + docs/animations.md + GIF previews
make database DATABASE=character.sqlite ASEPRITE=aseprite   # alternate DB filename
```

Python's standard-library SQLite engine executes `scripts/catalog.sql`
into a fresh file and seeds animation IDs/names from `scripts/lpc-animations.json`. Every invocation rebuilds the complete baseline, without
migrations, versions or history. Foreign keys and SQLite integrity are checked
before atomically replacing the output; failed builds leave the previous file
untouched. Preview rendering requires the prepared animation fixtures and Aseprite
CLI, but no Host or plugins. The database builder resolves `aseprite` from PATH,
then on macOS checks `/Applications/Aseprite.app/Contents/MacOS/aseprite`.
An explicit `ASEPRITE` override is respected and fails visibly if invalid. Root `*.sqlite` files,
SQLite sidecars and temporary build directories are Git-ignored and excluded
from the code-only package.

`gams.json` uses `"sql": "db.sqlite"`. An alternate filename must also be set in
that config. Close the GAMS Project/preview before rebuilding, then reopen it:
atomic replacement does not switch an already-open SQLite connection to the new
file. Rebuilding discards manual database edits; View reload/Reset does not.
Items, palettes and sprites remain empty. The animation registry now contains
ten actual animated clips from the default body/head source sheets. The remaining
two source pairs, Emotes and Sitting, supply seven separately selected static
poses; they are not combined animation cycles or seeded into the animation table.
Runtime sprite playback is not connected by this documentation step.

### Generated animation reference

[`docs/animations.md`](docs/animations.md) is generated by `make database`, with
the current Project's **ID | Name | Directions | Frames | Image** animation table
first, followed by a separate static-pose table. Animation names are queried from
the newly built database; pose names come from the preparation manifest. Both
tables follow Project manifest order. Frames are counted per direction; each
static pose has one frame. The separate
[`docs/animation-reference.md`](docs/animation-reference.md) keeps the full
research inventory, historical sources and source-layout identification guidance
for later extraction/conversion. Research entries are not automatically adopted;
choosing new Project actions and a target conversion format remains explicit.
Both pages are regenerated together using their templates under `scripts/`.
Native 64×64 animated GIFs and single-frame pose PNGs contain only the default
body/head, without image borders or extra image spacing in the table. No clothes,
hair or equipment are included. `scripts/render-animation-docs.lua` checks both
components remain visible and verifies exported colors/transparency after decoding
again, plus frame counts and GIF timing.

Source PNGs remain unchanged under ignored `fixtures/lpc-animations/`; they are
reference inputs, not yet normalized indexed catalog sprites. All 12 source
pairs, dimensions, hashes and preview sequences are pinned in
`scripts/lpc-animations.json`. Climb has only a north-facing row; the other
previews face south. Head-only Expressions is not a body animation and is excluded.
Source guide timings are used where available; unknown clip timings remain
explicitly illustrative. Emotes/Sitting columns are held poses, shown separately
as 4 emote postures and 3 seated postures, without invented playback or emotions. See the generated page for attribution and timing details.

The documentation GIFs/PNGs and their OGA-BY 3.0 credits/license are retained in
`docs/images/animations/` for fixture-free wiki builds, but excluded from the
code-only View archive. Generating these derivatives is not a general catalog
importer or a resolution of the unrelated facial-hair provenance issue.

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

## SQL setup (catalog groundwork)

`gams.json` declares the SQL provider and `"sql": "db.sqlite"`. Run `make database`
before opening the Project. The View queries the existing file and never creates,
migrates or resets its schema. Character selections remain transient; no character
state is saved to SQLite. The build-time catalog snapshot seeds
slots and animation names; `items`, `palettes` and `sprites` are
defined but unpopulated. Fixture assets still drive the character preview.
The Host downloads/registers the plugin on Project load. From the native GAMS
console, the existing Host helper can be used to check the connection:

```js
const { sql } = await import('/util/sql.js')
await sql.value('SELECT sqlite_version()')
```

The owner previously confirmed the SQL provider works in native GAMS using
`view.sql`; this file-backed wiring still needs a packaged-app smoke check.
Browser checks use the canonical Host SQL helper over a thin preview transport
backed by real Python SQLite; they do not claim WASM/native integration coverage.

### Catalog baseline

Edit **`scripts/catalog.sql`**, close the Project/preview, run `make database`,
and reopen it. No SQL is replayed at runtime. View reload/Reset only rereads slot/animation
metadata and resets the transient character session, preserving database edits
and debug tables. There are **no version records, checksums, history tables or
migration framework**. The build creates the seeded editor registry:

- `slots(id, name, icon, order)` — editor slots and their explicit display order.

And four starting catalog tables:

- `palettes(id, data)` — `data` is JSON text checked to be an array of colors.
- `items(id, name, slot, icon, palette)` — required slot/default-palette references;
  `icon` stores indexed-PNG bytes as a BLOB.
- `animations(id, name)` — seeded from the 10 animated-clip entries in
  `scripts/lpc-animations.json`; the selector reads every row, sorted by name.
- `sprites(id, item, animation, layer, mask, data)` — required item/animation
  references and explicit positive integer layer; `mask` is 0/1, default 0;
  `data` stores image bytes.

Multiple sprites may share an item/animation (e.g. component images and masks).
Foreign keys protect referenced rows; no implicit deletion cascades are added.
BLOB checks enforce binary storage, not PNG validity/indexing; preparation must
validate images before insertion. Palette checks validate the JSON array container,
not individual colors yet. No current RGBA fixture icons are mislabeled/imported
as indexed PNGs. There is **no layers table**: numeric layer IDs directly specify
paint order, using the fixed [layer contract](docs/layers.md). For masks, the ID
specifies the target layer. Mandatory filenames are
`<animation_id>_<layer_id>[m].png`; missing/unknown IDs fail. The folder importer
and real sprite/mask raster playback remain future work.

The mock renderer already sorts explicit per-item layers and rejects equipped
items claiming the same drawing layer. Masks do not claim drawing occupancy;
there is no implicit priority or last-writer-wins. Slot order is independent. The View reads
`slots ORDER BY "order"`: first slot top-left, second top-right, then the next
row. SQL names drive tooltips, accessible labels, picker titles and related
palette labels; SQL icons drive empty equipment previews. An odd final slot
stays on the left. New slots without fixture assets show an empty inventory;
removed slots disappear rather than returning from JS defaults.

The artwork and palettes still use mock fixtures, now with explicit numeric
layers in their metadata. Editor slot order does not change render-layer order. Inspect the database in
`view.sql`; metadata edits there appear on View reload and are not overwritten.

The provider opens ordinary SQLite files/URIs; it does not import text SQL dumps.
The View reads the shared Host `/util/sql.js` connection. The local Project/debug
SQL tools can edit the file; production read-only enforcement is separate work.

See the current-scope section in [`CHARACTER_STUDIO_AGENT_SPEC.md`](CHARACTER_STUDIO_AGENT_SPEC.md)
for multi-component assets, targeted masks, and the boundary with the older draft.

## Browser visual harness

```sh
make preview
# http://127.0.0.1:8820/
```

Loopback-only harness with real sibling Host CSS/fonts/widgets, the98 CSS, and
the **actual sibling tooltip service**. `/fonts/game-icons.woff2` and its catalogue
are served directly from the Host; the font is not copied into this View.
Runtime/FS, SQL resource transport and Area-like chrome are stubbed; SQL executes
against the configured SQLite file in the loopback server. Regression mutations
are enclosed in a transaction and rolled back, including on failure. It does not
exercise Tauri, native plugin loading or the real layout
service. Override `PORT`, `GAMS_ROOT`, or `THEME_ROOT` as necessary.

The actual View now owns its `<colgroup>`-based 64×64 equipment/inventory
layout in its shadow DOM; native GAMS and this harness use the same code. There
is no browser-only sizing injection or special `?slots=fixed` mode. Oversized
zoom scrolls inside the flexible central preview rather than stretching slots.

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

## Try it

- Click an equipped **64×64 slot cell** to browse that slot. Inventory uses three
  64×64 square cells per row; extracted sprite icons remain native 32×32.
- Choose an inventory cell to equip it; no nested slot buttons. Names appear
  through `ui.tooltip.tip` on hover or keyboard focus; cells have accessible names.
- Each grid has one Tab stop. Arrows/Home/End move focus without equipping;
  Enter/Space selects. Ctrl/Meta+Home/End move to grid edges. Disabled entries
  are skipped. Focus survives activation; Tab/Shift+Tab exit the grid.
- Search by name; the first inventory item unequips the selected optional slot.
  That item is disabled for required body/head slots.
- Empty equipment slots use `i.game-icons` with catalogue-verified ligatures:
  person, head silhouette, hair, shirt, trousers, boots, helmet, beard, bowtie and
  outerwear. General controls and
  the remove entry retain Material Symbols. Both fonts use Host-owned CSS.
- Palette has nine rows and three columns: part name, palette selector and the
  selected palette's six actual colors. The read-only color strip uses the shared
  preview widget; no additional View-specific CSS. Skin, hair, facial hair,
  metal headwear and all clothing layers have independent palettes. Inventory icons follow the palette, but
  remain separate pre-extracted icon payloads.
- Change facing and 1×–4× zoom (default 3×).
- The side panel has an **Animation** selector with Play beside it. Names/IDs
  come from SQLite, not a fixed UI list. Idle still plays the existing three-frame
  fixture; other names are selectable but Play is disabled until real sprite data
  is connected. An empty animation table shows disabled controls. Changing the
  animation stops playback; reload/Reset refreshes the names and resets selection.
- Header actions use one slotted toolbar: Randomize/Reset are a nested button
  group; Facing and Zoom are direct toolbar children. Alignment uses shared
  Host/theme CSS, with no local header styling.
- Randomize or reset. Reload discards the complete session.
- Hover/focus/click **Credits · LPC Revised** for attribution and the facial-hair
  provenance warning.

No item-name legends, selected-item detail panel, alternate layout selector,
save/export controls or locally rendered tooltips. The only View-specific CSS
is the user-approved sizing exception above. The root's `display: contents`
follows the Core View guide.

## Development fixture repositories

Before artwork/animation/conversion development, download the registered upstream
checkout and prepare the Project's real source fixtures:

```sh
make fixture-repos              # pinned Universal LPC working tree, shallow history
make animation-fixtures        # current Project's pinned body/head sources
make fixtures ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite  # visual mock
make check-fixture-repos        # offline origin/revision/clean-worktree verification
```

On other systems use the installed Aseprite executable for `ASEPRITE`.
The full Universal LPC checkout is under ignored
`fixtures/repos/universal-lpc-generator` (roughly 500 MB locally), pinned to
`9bf06be193b053db256b2536824af426de046aa2`. No npm install or upstream build is run.
Existing checkouts are verified, never automatically pulled/reset or overwritten.
Preserve local experiments and update pins deliberately.

Track **every downloaded repository** in `scripts/fixture-repositories.json`:
URL, commit, clone/selected-file mode, local locations and associated source
manifests. It also records LPC-rework, ElizaWy/LPC, the original style guide and
legacy unified LPC as selected-file sources, not fictitious full clones.
File-level hashes, attribution and OGA download URLs remain in their linked
manifests. Register future sources before adding another downloader.

These are development-only fixtures, not submodules or vendored runtime code.
They remain excluded from the code-only package; fixture-free tests and packaging
must not start downloading them automatically.

## Assets and checks

`fixtures/` is intentionally Git-ignored for the initial bootstrap. Existing
local assets are retained. Prepare a fresh checkout before running the View,
preview or fixture checks:

```sh
make fixtures ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite
# Or ASEPRITE=aseprite when the CLI is on PATH.
```

The tracked scripts/manifest reproduce the ignored local assets; source files
and provenance are pinned and verified, never silently replaced on mismatch. Downloaded Host
artifacts under `tools/` and installed `gams_modules/` are also excluded from
version control. Maintained preview/check scripts live in tracked `scripts/`;
`tools/` is entirely local and Git-ignored.

See [`scripts/lpc-fixtures.md`](scripts/lpc-fixtures.md) for authors, licensing,
source commit/hashes, retained upstream credits and exact extraction changes.
Original sheets are unchanged RGBA PNGs; indexed normalization is not implemented.

```sh
make check
```

Checks cover syntax, config shape, original hashes, separate icon dimensions,
bundle bytes, ramps, provenance and all ten Game Icons names against the Host
catalogue. `scripts/fetch-lpc.py`, `extract-lpc-icons.lua` and `bundle-lpc.py`
provide the external fixture-preparation path. Browser smoke covers icon-only inventory,
service-owned name tips, equipping/removal, palettes, search, facing and idle.
Selectable grids additionally use the Host's shared keyboard/disabled guards and
shared selected/focus styling (the98 blue selection, dotted focus outline).
Native GAMS startup for this revision remains unverified.

For browser regressions against the real Host/theme cascade, run in the preview
page's console (these execute rendering checks, not just syntax checks):

```js
await import('/__preview__/game-icons.js').then(m => m.checkEquipmentIcons())
// passed: 10; checks glyph width and visible ink under actual shadow styles
await import('/__preview__/character-layout.js').then(m => m.checkCharacterLayout())
// passed: 55; slot/animation metadata, side-panel controls, empty state, keyboard, palettes and reset
await import('/__preview__/select-arrows.js').then(m => m.checkSelectArrows())
// passed: 10; standalone/table select states
```

On macOS, with `make preview` already running:

```sh
make check-webkit
```

This runs both glyph and shadow-layout regressions in an actual offscreen
`WKWebView`, the engine used by the desktop Host. The glyph test reproduced the
blank hair/trousers icons
before the shared Host CSS added `word-break: keep-all`; Chrome alone did not
reproduce that bug. The font itself is unchanged. Installed app bundles must be
rebuilt/upgraded to receive the CSS fix; this check is not a packaged-app smoke.

## Scope

The eventual catalog is selected at View level through GAMS SQL facilities.
Changing catalog reloads the View and loses the session. Catalog creation,
classification maintenance and asset CRUD remain outside this Project Unit.
`mock-catalog.json` is a UI fixture, **not a proposed SQLite schema**.

`CHARACTER_STUDIO_AGENT_SPEC.md` remains the earlier broader draft; its persistent
characters, recipes and full editor phases are not acceptance criteria here.
Next: evaluate this real-asset layout, then derive the smallest SQL read contract
from the interactions we retain.
