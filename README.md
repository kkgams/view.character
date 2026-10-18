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

## Open in GAMS

Download a released Host locally, as in `example.game3` (macOS Apple Silicon):

```sh
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

Override `GAMS_ROOT` if necessary. `gams.json` uses local `index.js`, pinned FS and
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

## SQL setup (catalog groundwork)

`gams.json` declares the SQL provider and `"sql": "memory"`. This is an empty,
transient development connection target; it does not persist character state or
change the read-only production catalog direction. The development snapshot seeds
`layers` and `slots`; `items`, `palettes`, `animations` and `sprites` are defined
but unpopulated. Fixture assets still drive the character preview.
The Host downloads/registers the plugin on Project load. From the native GAMS
console, the existing Host helper can be used to check the connection:

```js
const { sql } = await import('/util/sql.js')
await sql.value('SELECT sqlite_version()')
```

The owner confirmed SQL works in native GAMS using `view.sql`. The new snapshot
replay wiring still needs a packaged-app check. Browser checks use the canonical
Host SQL helper over a thin preview transport backed by real Python SQLite; they
do not claim WASM/native integration coverage.

### Unversioned development replay

Edit **`development.sql`**. Initial View mount and **every View reload/Reset**
read the whole file again through FS and replay it using `/util/sql.js`.
`development-db.js` handles quoted strings/identifiers, comments and trigger
bodies rather than splitting blindly at semicolons.

**Reload is intentionally destructive:** all non-internal tables, views and
triggers in the configured memory database's main schema are cleared, including
manual debug tables, and the file recreates the baseline. Reset and replay share
one transaction; a failure restores the previous schema/data and reports an
error. Foreign-key consistency is checked before commit. Replays are serialized.
Do not put transaction commands in the SQL file; the loader owns them.

There are **no version records, checksums, history tables or migration framework**.
The SQL file currently creates two seeded registries:

- `layers(id, name, order)` — ten current render passes, in painter order.
- `slots(id, name, icon, order)` — editor slots and their explicit display order.

And four empty starting tables:

- `palettes(id, data)` — `data` is JSON text checked to be an array of colors.
- `items(id, name, slot, icon, palette)` — required slot/default-palette references;
  `icon` stores indexed-PNG bytes as a BLOB.
- `animations(id, name)`.
- `sprites(id, item, animation, mask, data)` — required item/animation references;
  `mask` is an integer restricted to 0/1, default 0; `data` stores image bytes.

Multiple sprites may share an item/animation (e.g. component images and masks).
Foreign keys protect referenced rows; no implicit deletion cascades are added.
BLOB checks enforce binary storage, not PNG validity/indexing; preparation must
validate images before insertion. Palette checks validate the JSON array container,
not individual colors yet. No current RGBA fixture icons are mislabeled/imported
as indexed PNGs. A mask flag alone does not specify its target or render layer;
those bindings and database-driven sprite rendering remain future work.

There is no slot/layer foreign key or one-to-one constraint. The View reads
`slots ORDER BY "order"`: first slot top-left, second top-right, then the next
row. SQL names drive tooltips, accessible labels, picker titles and related
palette labels; SQL icons drive empty equipment previews. An odd final slot
stays on the left. New slots without fixture assets show an empty inventory;
removed slots disappear rather than returning from JS defaults.

Edit `development.sql`, then reload the character View to apply changes. The
asset fixtures, palettes and painter order are still mock definitions; editor
slot order does not change render-layer order. Inspect both tables in `view.sql`
after reloading. Replay runs on reload, not on selection, palette changes or
ordinary render calls. Replay is guarded to
`"sql": "memory"`; it will not reset a persistent database.

The provider itself still opens SQLite files/URIs or memory, not text SQL dumps,
and `sql.exec()` processes one statement per call. Future external preparation
will produce the real SQLite `db.sqlite`; production read-only loading is not
implemented by this development helper.

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
against a real in-memory Python SQLite connection in the loopback server. It does not exercise Tauri, native plugin loading or the real layout
service. Override `PORT`, `GAMS_ROOT`, or `THEME_ROOT` as necessary.

The actual View now owns its `<colgroup>`-based 64×64 equipment/inventory
layout in its shadow DOM; native GAMS and this harness use the same code. There
is no browser-only sizing injection or special `?slots=fixed` mode. Oversized
zoom scrolls inside the flexible central preview rather than stretching slots.

### User-approved sizing exception

The user explicitly approved `APPROVED_LAYOUT_CSS` in `index.js`, inside the
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
- Change facing and 1×–4× zoom (default 3×); play the three actual idle frames.
- Header actions use one slotted toolbar: Randomize/Reset are a nested button
  group; Facing, Zoom and Play are direct toolbar children. Alignment uses shared
  Host/theme CSS, with no local header styling.
- Randomize or reset. Reload discards the complete session.
- Hover/focus/click **Credits · LPC Revised** for attribution and the facial-hair
  provenance warning.

No item-name legends, selected-item detail panel, alternate layout selector,
save/export controls or locally rendered tooltips. The only View-specific CSS
is the user-approved sizing exception above. The root's `display: contents`
follows the Core View guide.

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
// passed: 53; slots, metadata/order changes, odd counts, tooltip names, keyboard, palettes and reset
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
