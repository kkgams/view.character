# view.character — LPC visual prototype

**Question:** does a compact, equipment-style character browser feel right before
we design the SQL read contract? Variant A is retained; B/C and the procedural
mannequin have been removed.

The View now uses twelve real, pinned LPC Revised source layers: body, head,
three hairstyles, three shirts, two leg pieces and two footwear options. This
is still a **throwaway visual mock**, not an importer, database or asset editor.

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
Normal fixture loading needs no upstream asset download or Aseprite installation.
No SQL plugin is required by this slice.

The Host supplies `/widgets/animation-preview.js`, `/util/view-plugin.js`,
`/util/selectable-grid.js`, `/core/runtime.js` and their dependencies; they are
not vendored here. Use a Host containing the grid helper and Game Icons font/CSS
(the installed 2.0.7 bundle or updated sibling source). Older downloaded apps do
not acquire these files automatically. Native startup is still a separate smoke
check; the browser harness uses the canonical sibling Host/theme sources.

## Browser visual harness

```sh
make preview
# http://127.0.0.1:8820/
```

Loopback-only harness with real sibling Host CSS/fonts/widgets, the98 CSS, and
the **actual sibling tooltip service**. `/fonts/game-icons.woff2` and its catalogue
are served directly from the Host; the font is not copied into this View. Only runtime/FS and Area-like chrome are
stubbed. It does not exercise Tauri, native plugin loading or the real layout
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
  person, head silhouette, hair, shirt, trousers and boots. General controls and
  the remove entry retain Material Symbols. Both fonts use Host-owned CSS.
- Palette has five rows and three columns: part name, palette selector and the
  selected palette's six actual colors. The read-only color strip uses the shared
  preview widget; no additional View-specific CSS. Change skin, hair, top, legs
  and footwear palettes independently. Inventory icons follow the palette, but
  remain separate pre-extracted icon payloads.
- Change facing and 1×–4× zoom (default 3×); play the three actual idle frames.
- Header actions use one slotted toolbar: Randomize/Reset are a nested button
  group; Facing, Zoom and Play are direct toolbar children. Alignment uses shared
  Host/theme CSS, with no local header styling.
- Randomize or reset. Reload discards the complete session.
- Hover/focus/click **Credits · OGA-BY 3.0** for attribution.

No item-name legends, selected-item detail panel, alternate layout selector,
save/export controls or locally rendered tooltips. The only View-specific CSS
is the user-approved sizing exception above. The root's `display: contents`
follows the Core View guide.

## Assets and checks

`fixtures/` is intentionally Git-ignored for the initial bootstrap. Existing
local assets are retained, but a fresh checkout needs those fixtures supplied
separately before the View, preview, or fixture checks can run. Downloaded Host
artifacts under `tools/` and installed `gams_modules/` are also excluded from
version control. Maintained preview/check scripts live in tracked `scripts/`;
`tools/` is entirely local and Git-ignored.

See [`fixtures/lpc/README.md`](fixtures/lpc/README.md) for authors, licensing,
source commit/hashes, retained upstream credits and exact extraction changes.
Original sheets are unchanged RGBA PNGs; indexed normalization is not implemented.

```sh
make check
```

Checks cover syntax, config shape, original hashes, separate icon dimensions,
bundle bytes, ramps, provenance and all six Game Icons names against the Host
catalogue. The asset-preparation scripts are currently missing; `make fixtures`
requires restoring those separately under `scripts/`. Browser smoke covers icon-only inventory,
service-owned name tips, equipping/removal, palettes, search, facing and idle.
Selectable grids additionally use the Host's shared keyboard/disabled guards and
shared selected/focus styling (the98 blue selection, dotted focus outline).
Native GAMS startup for this revision remains unverified.

For browser regressions against the real Host/theme cascade, run in the preview
page's console (these execute rendering checks, not just syntax checks):

```js
await import('/__preview__/game-icons.js').then(m => m.checkEquipmentIcons())
// passed: 6; checks glyph width and visible ink under actual shadow styles
await import('/__preview__/character-layout.js').then(m => m.checkCharacterLayout())
// passed: 30; slots, removal/equipping, keyboard focus, zoom, palette colors and reset
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
