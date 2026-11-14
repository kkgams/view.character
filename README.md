# view.character

A pre-alpha SQLite equipment browser and transient character composer for
[GAMS](https://github.com/kkgams/gams). Supply a compatible database at
`catalog/catalog.sqlite` (or change `gams.json`); no artwork, database builder or
catalog producer checkout is included or required. Close and reopen the Project
or preview after replacing the database externally.

| Unit | Source | Screenshot | License / author |
| --- | --- | --- | --- |
| `view-character` | [View](src/views/view-character.js) | Not available | [Apache-2.0](LICENSE), [notice](NOTICE) / GAMS contributors |

## Development

Requires Make, Node.js 24+ and Python 3; packaging also uses ZIP and shasum.
Native Host download/open supports macOS Apple Silicon and preserves accompanying
notices. The Host installs the explicitly pinned supporting Units on first launch.
No npm installation is needed.

| Command | Purpose |
| --- | --- |
| `make open` | Check source and supplied database, then open the local Project in the released Host; no sibling checkout needed. |
| `make tools/gams.app` | Download the released Host only when absent; retain an existing app. |
| `make check` | Check JavaScript and Python source syntax. |
| `make test` | Run native dependency-free JavaScript domain tests; no database or artwork required. |
| `make package` | Incrementally create `build.nosync/view.character.zip` and `SHA256SUMS`; code, LICENSE and NOTICE only. |
| `make serve-docs` | Serve the pinned wiki v1.4.0 on independent `DOCS_PORT` (default 8080). |
| `make docs` | Build the wiki under `build.nosync/site/`. |
| `make validate-docs` | Validate wiki content. |
| `make clean` | Remove guarded `build.nosync/`, identified Host downloads and configured completed Unit caches; preserve supplied tools, databases and unrelated caches. |
| `make preview` | Optional loopback diagnostic on `PORT` (default 8820); needs canonical sibling Host/theme/toast/tooltip sources. |
| `make check-webkit` | Optional macOS WebKit diagnostic; requires a running preview. |

Preview paths can be selected with `GAMS_ROOT`, `THEME_ROOT`, and the preview
script's options (`python3 scripts/preview.py --help`). Preview uses real SQLite
transport but stubbed runtime/chrome; it does not validate native Host startup.
Legacy `build/` and `dist/` output and supplied Host downloads predating ownership
markers are preserved by clean; inspect them before manual removal.

See [runtime and database contract](docs/runtime.md) for controls, schema/loading
requirements and the unchanged approved View-local sizing exception; see the
[layer contract](docs/layers.md) for composition. Selection is transient. No
production artwork approval or native packaged-app validation is implied.
