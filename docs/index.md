---
title: Character prototype
status: in-progress
---

# Character prototype

`view-character` is a pre-alpha character equipment browser: choose layered LPC
parts, preview palettes, change facing/zoom and play idle frames. SQL supplies
slot names/icons/order and all animation names in the side-panel selector, next
to Play. Only the existing Idle fixture plays; other names are visual placeholders
until real sprite data is connected. Artwork still comes from ignored local fixtures.
The prototype retains its local GAMS Project and browser preview.
`make database` builds an ignored `db.sqlite` ahead of time from the SQL snapshot
(`DATABASE=other.sqlite` overrides the filename; update `gams.json` to match),
with foreign-key/integrity checks and atomic replacement. The Project opens that
file directly. Close the Project/preview before rebuilding, then reopen it.
The generated [[animations|Project animations]] page puts the 10 currently
selected body/head clips first, with ID, name, directions and animated image.
Seven individual Emotes/Sitting poses follow as static PNGs in their own table. The
separate [[animation-reference|LPC sources and format history]] page keeps the
full research inventory, licenses and source-era/layout identification evidence
for future extraction and conversion decisions.
`make animation-fixtures` prepares the raw inputs; `make database ASEPRITE=aseprite`
regenerates both pages and the Project previews. Climb is north-only; no directions are invented.

The fixed numeric [[layers|layer contract]] defines paint order, required
fixture suffixes, masks and drawing conflicts; layers are not a SQL registry.
See the
[README](https://github.com/kkgams/view.character#readme) for setup and checks.

`npm run package` builds View code only; no database, SQL build inputs or LPC
assets are included, so the archive is not independently runnable. Initial mount
and Reset read the existing catalog without replaying SQL or changing database
schema/data. Asset redistribution, production read-only enforcement and version
1.0.0 are not prepared here. Three local facial-hair fixtures have unresolved attribution
and licenses and must not be bundled.
