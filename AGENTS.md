# view.character instructions

Follow the workspace rules and protected `../gams/docs/gams-view-development-guide.md`.
This directory is an independent Git repository. Keep its history and releases
separate from sibling repositories and the workspace root. Local `fixtures/`,
installed Units and the entire `tools/` directory are intentionally ignored.
Keep maintained development/check scripts in tracked `scripts/`; reserve
`tools/` for local/downloaded tool artifacts.

## Pre-alpha development SQL

`development.sql` is a complete unversioned snapshot, freshly read on initial
mount and every View reload/Reset. `development-db.js` transactionally clears
and rebuilds the disposable memory database's main schema. No version records,
checksums, migration history or framework are wanted at this stage. The SQL file
currently seeds independent `layers` and `slots` registries as the first SQL
validation slice. Editor slots, names and icons come from `slots ORDER BY
order`, arranged left/right pairs then top/down. Do not reintroduce a JS
slot metadata registry or fixed LEFT/RIGHT lists as the source of truth.
The user also added empty `items`, `palettes`, `animations` and `sprites` tables
with foreign keys, JSON-array palette data, BLOB image storage and a checked
0/1 mask flag. Assets/palettes and painter order still use fixture mocks for
rendering. Do not invent additional schema as loader plumbing, assume one slot
equals one render layer, or treat the mask flag as a defined target/layer binding.
Use the shared Host `/util/sql.js` connection so debug `view.sql` sees the same
database. Automatic replay must never reset a persistent/production database.

## Explicit user-approved View CSS exception

The user approved View-specific CSS **inside this View's shadow DOM only**, for
now, to size the equipment/inventory cells and control the character preview
viewport instead of drawing the equipment/inventory UI on canvas.

The approval is limited to `APPROVED_LAYOUT_CSS` in `index.js`: fixed 64×64 slot
cells, fixed outer equipment columns, a flexible central preview with scrolling
at oversized zoom, and inventory table width determined by its slot columns.
A subsequent explicit user approval adds **32px centered empty-slot and inventory
remove icons only**; equipped sprites and toolbar icons retain their shared sizing.
The user also approved **three square inventory cells per row**, using explicit
64px dimensions. The ineffective `aspect-ratio` rule was removed at the user's
request. This remains View-local, not a shared sizing contract.
The shadow root still loads canonical Host reset/base CSS and the current theme
through `/util/add-style.js`. Colors, font families, borders, selection/focus/disabled
appearance, widgets, keyboard behavior and tooltip ownership remain shared.

**Any addition to View-specific CSS requires fresh explicit user approval.**
Do not use this exception to introduce further local styling or generic sizing
utilities. Do not extend shared Host/theme CSS or the protected View guide for
these sizing exceptions. Keep the exception recorded here and in the README.

The actual View owns this layout, so native GAMS and the browser harness run the
same code. Do not reintroduce a browser-only sizing override or monkeypatch.
