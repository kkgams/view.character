# view.character

This is a pre-alpha visual prototype and its local development Project, not a
production character editor. Canonical View source lives under src/views/.
Build-time scripts/catalog.sql plus scripts/lpc-animations.json create ignored
db.sqlite via make database; this also generates the credited body/head animation
docs and GIFs using pinned raw fixtures and Aseprite. The raw source sheets are
not a finished indexed catalog importer, and runtime playback remains separate;
gams.json and the preview harness open that ordinary SQLite file. View reload
and Reset never migrate, reseed or wipe the database. LPC fixtures remain
ignored Project-local inputs, not archive contents.

Keep database preparation outside the View and preserve the exact approved
View-local CSS exception documented in AGENTS.md. The Host owns runtime,
SQL helpers, grid/preview widgets, UI Services and theme styling.

Packaging and wiki setup follow template.view. Local archives strip src/ and
include LICENSE, NOTICE, README.md and NOTES.md, without unit.json. Version 0.0.0
is a packaging placeholder only. CI verifies/builds; no release publisher or
production 1.0.0 preparation is included. Production deployment and asset license
resolution remain separate work. Do not commit, tag, push or publish unless asked.
