.DEFAULT_GOAL := help
GAMS_ROOT ?= ../gams
THEME_ROOT ?= ../theme.the98
PORT ?= 8820
PYTHON ?= python3
NODE ?= node
SWIFT ?= /usr/bin/swift
ASEPRITE ?= aseprite
CURL ?= curl
GAMS_RELEASE_API ?= https://api.github.com/repos/kkgams/gams/releases/latest
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

.PHONY: help run run-app preview fixtures check check-webkit
help:
	@printf '%s\n' 'make tools/gams.app  Download the latest released GAMS Host (macOS Apple Silicon)' 'make run-app         Open this Project in the downloaded GAMS Host' 'make run             Open this Project in the sibling development GAMS Host (Nix)' 'make preview         Browser visual harness with real Host CSS/widgets and a stub runtime' 'make fixtures        Refetch/rebuild pinned LPC mocks (requires Aseprite CLI)' 'make check           Check syntax, Project config and offline fixture integrity' 'make check-webkit    Verify glyphs and shadow layout in WKWebView (macOS; preview must be running)'

run:
	cd "$(GAMS_ROOT)" && nix develop --command make run GAMS_APP_CWD="$(CURDIR)"

# Like example.game3: retain an existing app; never update it implicitly.
tools/gams.app:
	@test "$(UNAME_S)" = Darwin && test "$(UNAME_M)" = arm64 || \
		{ echo 'GAMS release download requires macOS Apple Silicon' >&2; exit 1; }
	@test ! -e tools/gams-release-notices || \
		{ echo 'tools/gams-release-notices already exists; move it aside before reinstalling GAMS' >&2; exit 1; }
	@mkdir -p tools
	@set -eu; stage=$$(mktemp -d "tools/.gams-download.XXXXXX"); \
		trap 'rm -rf "$$stage"' EXIT; \
		$(CURL) --fail --location --silent --show-error "$(GAMS_RELEASE_API)" --output "$$stage/release.json"; \
		url=$$($(PYTHON) -c 'import json, sys; release = json.load(open(sys.argv[1])); assets = [a for a in release["assets"] if a["name"].startswith("GAMS-") and a["name"].endswith("-macos-aarch64.zip")]; assert len(assets) == 1, "Expected exactly one GAMS macOS Apple Silicon ZIP asset"; print(assets[0]["browser_download_url"])' "$$stage/release.json"); \
		$(CURL) --fail --location --silent --show-error "$$url" --output "$$stage/gams.zip"; \
		unzip -q "$$stage/gams.zip" -d "$$stage/unpacked"; \
		test -f "$$stage/unpacked/GAMS.app/Contents/Info.plist"; \
		test -x "$$stage/unpacked/GAMS.app/Contents/MacOS/gams"; \
		mv "$$stage/unpacked/GAMS.app" "$$stage/GAMS.app"; \
		mv "$$stage/unpacked" tools/gams-release-notices; \
		mv "$$stage/GAMS.app" "$@"

run-app: tools/gams.app
	GAMS_APP_CWD="$(CURDIR)" ./tools/gams.app/Contents/MacOS/gams

preview:
	$(PYTHON) scripts/preview.py --host "$(GAMS_ROOT)" --theme "$(THEME_ROOT)" --port "$(PORT)"

check-webkit:
	@test "$(UNAME_S)" = Darwin || { echo 'WKWebView check requires macOS' >&2; exit 1; }
	$(SWIFT) scripts/check-icons-webkit.swift "http://127.0.0.1:$(PORT)/"

fixtures:
	$(PYTHON) scripts/fetch-lpc.py
	$(ASEPRITE) -b --script-param root="$(CURDIR)/fixtures/lpc" --script scripts/extract-lpc-icons.lua
	$(PYTHON) scripts/bundle-lpc.py

check:
	$(NODE) --input-type=module --check < index.js
	$(NODE) --input-type=module --check < development-db.js
	$(NODE) --test scripts/development-db.test.mjs
	$(PYTHON) scripts/check-lpc.py --host "$(GAMS_ROOT)"
	$(NODE) --input-type=module --check < scripts/game-icons.browser.js
	$(NODE) --input-type=module --check < scripts/character-layout.browser.js
	$(PYTHON) -c 'import ast,json,pathlib; ast.parse(pathlib.Path("scripts/preview.py").read_text()); c=json.loads(pathlib.Path("gams.json").read_text()); assert c["ui"]["views"]["view-character"]["url"] == "index.js"; assert len(c["ui"]["services"]) == 6; assert c["sql"] == "memory"; assert "https://github.com/kkgams/plugin.sql/releases/download/v0.2.0/plugin.sql.wasm" in c["plugins"]; print("Project config, SQL provider and Python syntax OK")'
