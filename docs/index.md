---
title: Character prototype
status: in-progress
---

# Character prototype

`view-character` consumes a supplied SQLite database. It queries slots, items,
icons, sprite BLOBs, GPL palettes and animations through Host `/util/sql.js` on
each reload/Reset. It does not extract artwork, create schema or read source
files. All four-direction NESW geometry, playback sequences and timing are
provided by the database; unsupported parts are omitted with warnings.

Supply the database configured by `gams.json` (`catalog/catalog.sqlite` locally),
using a regular file or the ignored development directory symlink.
Catalog sources and production tooling live outside this View repository. Close
and reopen the Project/preview after externally replacing the database file.
Reset invalidates render caches and transient selections, not database records.

Every slot may unequip. Initial selection uses its first stable item ID when
present. Palette alternatives require equal index counts and default to each
item's palette. The [[layers|layer contract]] defines numeric paint order,
indexed palette handling, masks and drawing conflicts.

See the [README](https://github.com/kkgams/view.character#readme) for launch,
controls, checks and the approved View-local sizing exception. The loopback
preview uses canonical Host/theme code and real SQLite transport, with stubbed
runtime/chrome. Native packaged-app startup remains unverified.

`npm run package` contains View code only: no database, artwork or catalog build
tools. Version 0.0.0 is a local packaging placeholder, not release preparation.
