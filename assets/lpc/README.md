# Reproducible LPC animation research catalog

Start with the **LPC Animation Reference** section of `../../CONTEXT.md` and
[ATTRIBUTION.md](ATTRIBUTION.md). This is research data, **not** the View's
`scripts/lpc-animations.json` registry, indexed importer or runtime SQL input.
Nothing in this directory changes playback, rebuilds the database, replaces
custom spritesheets or grants production deployment clearance.

```sh
python3 scripts/validate_lpc_animations.py  # from the repository root; offline
python3 scripts/fetch_lpc_catalog.py       # restore absent files, verify existing bytes
```

The fetcher never overwrites a file with unexpected bytes. GitHub files are
commit-pinned; mutable OGA downloads are content-pinned, so an upstream change
fails rather than silently updating this snapshot. Missing 2021 jump data is
restored by fetching its SHA256-pinned original 7z archive and extracting only
the named member through libarchive `tar -xOf` (macOS system tar supports this;
GNU tar alone may not). The whole 7z pack is not imported into this repository.
The push/carry ZIP is retained unchanged, with its README and two selected body
PNGs extracted for direct validation. Fetching is optional when files are present.

## Development repository checkouts

Selected research files here do not replace full development checkouts. Run
`make fixture-repos` to prepare the pinned Universal LPC working tree at ignored
`fixtures/repos/universal-lpc-generator`. Repository downloads, exact revisions,
local paths and selected-file versus clone modes are tracked in
`scripts/fixture-repositories.json`; register future repository sources there.
`make check-fixture-repos` verifies existing clones offline without pulling or
resetting local work. File-level attribution/hashes remain in this catalog.

## Schema and coordinate conventions

`animations.json` contains:

- `sources`: repository revisions, source URLs and historical caveats.
- `assets`: file URLs, hashes, dimensions, authors, licenses, license evidence,
  optional archive member/hash, and research-only production status.
- `layouts`: independent physical/definition layouts and their order basis.
- `animations`: source-specific variants linked by `canonical_id` so repeated
  action names do not become fictitious new animation families.
- `unresolved`: explicit limitations, conflicting generations and unknowns.

All rows/columns are **zero-based inclusive**. A pose at `(column, row)` is
`[column × frame_width, row × frame_height, frame_width, frame_height]` in its
listed source image. Four-row source strips use north, west, south, east.
Single-row Hurt is south, Climb north. Global composite rows are different from
local strip rows; the modern composite definition has no downloaded combined
image, so those records are `verified: false` despite verified source definitions.

`frame_counts` counts **physical pose columns**, not pixels or playback steps.
`physical_frames` and `column_ranges` locate stored cells. `playback_order`
contains source-column indexes and may skip/repeat them. Thus Walk has nine
stored poses but an eight-step moving cycle; modern Idle is `0,0,1`; the modern
1h slash uses only seven columns of a shared thirteen-column backslash strip.
A null sequence/FPS/loop is unknown or unspecified, not a guessed sequential
cycle, 100ms default or automatic one-shot. `generator_preview` and authored
`timing_profiles` are separate from intrinsic artwork/gameplay timing.

`order` is local to the named definition/inventory, **not** a universal animation
order. LPCR independent files have `order: null`; their HeadPlacement key
serialization is retained separately, not promoted to a canonical order. Custom
output blocks have dynamic global y offsets; exact borrowed body-pose references
are retained verbatim. Never use the conflicting legacy custom row lookup as a
modern offset table without choosing the appropriate extraction path.

Verified means definition/source existence and downloaded geometry were checked,
not that unknown history, timing or legal integration has become confirmed.
Some unverified candidates have confirmed definitions but no representative
item-sheet download; others have no geometry evidence at all. See each entry.

The validator checks hashes, PNG chunk checksums/dimensions, per-file provenance,
licenses, extraction bounds, strip widths, retained alpha-occupancy evidence,
frame/sequence references, guide timing shape and source-defined ordering.
It does not infer an animation's semantics from pixels or audit licenses for
assets that were not collected.
