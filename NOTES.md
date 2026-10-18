# Notes

The template alignment retains the visual prototype, Project config, native
launch targets, loopback preview and local fixture-preparation/check tooling.
The View lives under src/views/. Build-time scripts/catalog.sql is compiled with
make database to ignored db.sqlite; gams.json opens that file through the shared
Host SQL helper. No SQL snapshot or migration helper is loaded by the View. LPC fixture paths
remain Project-local and all fixture bytes stay ignored and excluded.

Version 0.0.0 exists only to support local packaging. There is no 1.0.0 release
preparation, release publisher, tag or publication in this change. Fixture-free
CI tests/builds the code archive; local make check additionally needs prepared
fixtures and sibling Host resources. Wiki setup follows justgook/wiki v1.4.0.

The code archive is not a self-contained character editor: without separately
prepared LPC fixtures it cannot render the prototype. Three facial-hair assets
have unresolved attribution/licenses and must not be bundled. Keep existing
fixture provenance warnings and the approved CSS boundary intact. Initial mount
and Reset preserve the database, resetting only the transient session. Close the
Project/preview before rebuilding the file, then reopen it. Production read-only
enforcement and asset licensing remain future work.
