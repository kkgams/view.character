# Notes

This repository owns a SQLite-consuming View, local GAMS Project and loopback
preview. Catalog creation and source-artwork research belong outside the View.
The local ignored `catalog` directory symlink is development wiring to an independent
producer. `gams.json` selects `catalog/catalog.sqlite`; a regular compatible database
at that configured path works without its source checkout. The code-only baseline
contains no database; legacy `db.sqlite` has been removed.

Tests use synthetic records/PNGs and do not require catalog production tools or
assets. The code-only archive contains no database, source artwork, Host/theme
libraries, installed Units or downloaded tools. The runtime uses canonical Host
SQL/widgets/helpers and the shared theme. Approved View-local sizing remains
bounded by AGENTS.md.

Reset only rereads the existing connection and transient state; reopen the
Project/preview after an external atomic database replacement. Production
read-only enforcement and catalog-specific licensing remain separate concerns.
Version 0.0.0 is a tooling placeholder; release publication and native packaged-app
startup remain unverified. No commits or publishing are included in this work.
