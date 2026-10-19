---
title: Character prototype
status: in-progress
---

# Character prototype

`view-character` is a pre-alpha character equipment browser: choose layered LPC
parts, preview palettes, change facing/zoom and play idle frames. SQL supplies
slot names/icons/order and all animation names in the side-panel selector, next
to Play. The grouped selector includes imported animation names and seven held
static poses. Compatible parts render even if other equipped items lack frames;
those items stay equipped and receive danger intent in equipment and inventory,
with an explicit omission warning instead of an Idle substitution. Poses disable Play, and Climb
exposes north only. Artwork comes from ignored prepared motion fixtures.
The prototype retains its local GAMS Project and browser preview.
`make database` builds an ignored `db.sqlite` ahead of time from the SQL snapshot
(`DATABASE=other.sqlite` overrides the filename; update `gams.json` to match),
with foreign-key/integrity checks and atomic replacement. The Project opens that
file directly. Close the Project/preview before rebuilding, then reopen it.
The generated [[animations|Project animations]] page now describes the first
normalized catalog slice: one indexed body Walk item, with NESW direction rows,
64×64 frame geometry and explicit playback timing. SQL animation names reflect
the imported catalog; the prepared raw motion fixtures still support ten clips
and seven poses, but clips appear only when registered in SQLite. View rendering
still uses those raw fixtures, not imported sprite BLOBs.
The separate [[animation-reference|LPC sources and format history]] page retains
the broader research inventory and upstream geometry.

```sh
make animation-fixtures fixtures ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite
make catalog-fixtures
make database ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite
```

`make catalog-fixtures` does not overwrite changed local catalog files.
`make database CATALOG=catalog` imports existing prepared inputs and
regenerates only the current Project animation page and its previews.

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
