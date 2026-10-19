---
title: Character prototype
status: in-progress
---

# Character prototype

`view-character` is a pre-alpha SQLite-backed equipment browser. Each reload/Reset
queries slots, items, icons, sprites, GPL palettes and animations through shared
Host `/util/sql.js`, clears decoded/render caches and resets transient selections.
It never writes schema/data or reads FS; no mock/motion catalogs or cached
fixtures drive playback. Initial selections use the first stable item ID per
slot; every slot may unequip. Palette names come from SQLite GPL records,
alternatives require equal index counts, and each item defaults to its palette.

The initial catalog contains one indexed body Walk item; other slots are empty.
Geometry, sequence and timing come solely from SQLite, with fixed NESW
four-direction sheets. [[animations|Project animations]] documents this imported
selection. Raw animations and held poses are not automatically adopted.
[[animation-reference|LPC sources and format history]] retains the broader offline
research and upstream geometry.

## Offline preparation

```sh
make animation-fixtures fixtures ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite
make catalog-fixtures
make database ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite
```

`make catalog-fixtures` prepares lossless indexed NESW inputs without overwriting
changed local files. `make database CATALOG=catalog` imports the existing folder
using `scripts/catalog.sql`, atomically replaces `db.sqlite` and generates the
Project animation page/GIFs. Close the Project/preview before rebuilding and reopen
afterward; alternate database filenames must match `gams.json`. Preparation and
research fixtures remain offline inputs, not runtime startup dependencies.

The [[layers|layer contract]] defines numeric paint order, filenames, indexed
palettes, target masks and drawing conflicts. The catalog helper preserves
duplicate-RGB indexes and applies masks to separate layer buffers before flattening.
Provenance stays in prepared inputs/generated docs, not a SQL author schema.
Catalog information is generic; unimported historical fixtures do not add runtime
warnings.

See the [README](https://github.com/kkgams/view.character#readme) for controls,
checks and the unchanged approved View-local CSS exception. The loopback preview
serves the single View file and canonical Host/theme sources, with real SQLite
transport and no FS routes or fixture startup requirements. Native Tauri
packaged-app startup remains unverified.

`npm run package` builds View code only: no database, SQL build inputs or LPC
assets. Supply a prepared catalog separately. Asset redistribution, production
read-only enforcement, release publication and version 1.0.0 are not approved
by this prototype.
