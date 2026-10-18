# LPC visual fixtures — not a database contract

The bounded selection in `scripts/lpc-fixtures.json` pins
[justgook/LPC-rework](https://github.com/justgook/LPC-rework) commit
`3d14b9715136dede36de55907b1b2d720a8ff306`. All generated/downloaded assets live
under ignored `fixtures/lpc/`; preparation is outside the actual View.

## Selection and provenance

Twenty unchanged RGBA source PNGs supply ten slots:

- Body/head, three hairstyles, three shirts, two leg pieces, two footwear options.
- Headwear: Norman and Kettle helmets.
- Facial hair: trimmed beard, medium beard and walrus mustache.
- Neckwear: bowtie.
- Outerwear: suspenders and cardigan.

The root README's broad CC-BY/OGA-BY statement is not a per-item license audit.
**The three facial-hair items are absent from the retained per-item credits.**
They are marked `UNVERIFIED` with an explicit provenance note in the manifest
and runtime mock. Do not infer an author/license or redistribute them based on
this local visual prototype. Resolving attribution/license is separate work.
There is no claim that this selection is a policy-filtered published catalog.

The other seventeen selected records have explicit OGA-BY 3.0 coverage:

- `credits-characters.txt`: body/head; Stephen Challener (Redshrike), Durrani,
  Eliza Wyatt (DeathsDarling), BenCreating, Salvador Oblea Jr. (joblea).
- `credits-hair.txt`: Parted/Curly by Eliza Wyatt; Page by Johannes Sjölund
  (Wulax) and Eliza Wyatt. It does **not** individually credit the beard files.
- `credits-clothing.txt`: shirts, leg/footwear, bowtie, suspenders and cardigan
  by Eliza Wyatt, based on the LPC body/animations credited in that file.
- `credits-head-accessories.txt`: helmets by Eliza Wyatt.

Full unmodified records, upstream README, original ramps/head-placement metadata
and the OGA-BY 3.0 license text are retained under `fixtures/lpc/provenance/`.
SHA-256 digests of all originals and provenance files are pinned in the manifest.
Keep the attribution/license records with any lawfully redistributed derivatives.
These consistency checks do not constitute a legal audit or publication approval.

## Data and rendering

- `originals/`: twenty original 192×256 PNGs, unchanged and not palette-normalized.
- `icons/`: separate 32×32 PNGs extracted with Aseprite. Crop the first south-facing
  64×64 frame to its nontransparent bounds, then center at native resolution.
  Extraction fails instead of rescaling if an icon cannot fit. Existing icons
  are retained; explicitly delete a derived icon to rebuild it.
- `sources.json`: generated copy of the tracked selection and provenance manifest.
- `mock-catalog.json`: disposable inline PNG payloads, frame map and source ramps.
  Base64 avoids companion-file problems with the Host blob loader. This is not
  a proposed SQLite or published-catalog storage schema.

Sheets contain three actual idle frames, rows north/west/south/east. They are
already aligned, including the idle head motion; head-placement metadata is
retained, not reapplied. No directions/frames are fabricated. Source ramps are
Ivory (skin), Blonde (hair/facial hair), Dove (clothing) and Steel (metal).

The View uses independent palettes and composites in explicit painter order:
body, legs, feet, top, outerwear, neckwear, head, hair, facial hair, headwear.
Board placement is independent of that order. Body/head are required; every
other slot can be unequipped. Reload discards all choices.

## Reproduce

From `view.character/`:

```sh
make fixtures ASEPRITE=/Applications/Aseprite.app/Contents/MacOS/aseprite
make check
```

Python 3 stdlib fetches and bundles; Aseprite runs `scripts/extract-lpc-icons.lua`.
Existing originals/provenance must match their pinned hashes; mismatches fail
without overwriting them. Normal View startup needs neither Aseprite nor network.

For isolated preparation checks, both Python scripts accept `--root <directory>`;
the Lua script accepts `--script-param root=<absolute-directory>`. Its MCP entry
also accepts `_G.LPC_FIXTURE_ROOT` with an absolute fixture directory.
