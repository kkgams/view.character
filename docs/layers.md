---
title: Layer contract
status: reference
---

# Layer contract

Layer IDs **are numeric paint order**: lower numbers are behind higher numbers.
There is no `layers` database table, layer foreign key or separate render-order
field. Slot display order remains independent. A slot does not imply a layer.

This fixed initial contract is mirrored by `LAYERS` in
`src/views/view-character.js`; tests check that the definitions agree. Extend
both deliberately when a new drawing level is needed. Unknown IDs fail rather
than falling back to a slot, default layer or arbitrary z-position.

| ID | Name |
| --- | --- |
| 5 | Back equipment |
| 9 | Back hair |
| 10 | Body |
| 20 | Legs |
| 25 | Feet |
| 35 | Base torso |
| 38 | Straps and apron |
| 55 | Outerwear |
| 85 | Front cape |
| 90 | Neckwear |
| 100 | Head |
| 110 | Facial hair |
| 120 | Front hair |
| 130 | Headwear |

These are component roles, not equipment slots. One hair item can supply both
layers 9 and 120. Historical offline suspenders and cardigan fixtures use layers
38 and 55 respectively; they are not imported by the initial body Walk catalog.

## Required catalog filenames

The normalized item preparation format uses:

```text
catalog/
  slots.json
  animations.json
  palettes/
    dungeon.gpl
  items/
    headwear/
      helmet/
        data.json
        icon.png
        walk_130.png
        walk_120m.png
        walk_9m.png
```

- `data.json` supplies the item name and a required palette reference, e.g.
  `{"name": "Helmet", "palette": "dungeon"}`. Paths supply slot/item identity;
  the generated item ID is slot-qualified, such as `headwear/helmet`. The
  `items/` directory is organizational and is not included in database IDs.
- `slots.json` supplies required slot names/icons/display order. Folders under `items/`
  must match slot IDs; missing required metadata is an error.
- `animations.json` is an array of `{id, name, frame_width, frame_height,
  frame_count, directions, sequence, durations_ms, timing_note}`. `frame_count`
  counts stored frames per direction; `sequence` is zero-based playback order.
  Durations are per sequence step, positive integer milliseconds divisible by 10
  for lossless GIF documentation. `timing_note` identifies source timing or
  explicitly illustrative holds. SQLite stores geometry, direction order and the
  two playback arrays; the note remains in JSON for documentation.
- `slots.json` is an array of `{id, name, icon, order}` with unique IDs/orders.
  Each discovered slot directory must have a matching record. Metadata-only
  slots are allowed, keeping empty equipment slots in the prototype.
- `icon.png` is 32×32 indexed PNG, with the same full palette as drawing sheets.
  `palettes/<id>.gpl` supplies visible RGB entries in order; GPL entry 1 maps
  to PNG index 1. Index 0 is reserved for transparency and is not in GPL.
  Sprite BLOBs retain their PNG bytes.
  Each item has at least one drawing component. Masks use exactly two opaque
  palette entries: black at index 0 and white at index 1.
- Slot/item IDs use lowercase letters, digits, hyphens or underscores, starting
  with a letter. Sprite IDs are `<slot>/<item>/<filename stem>`. Palette IDs
  are GPL filenames without `.gpl`, using the same ID rules. `palettes` and
  `provenance` are reserved root directory names, not slot IDs.
- Every animation image must be `<animation_id>_<layer_id>[m].png`, with a
  positive decimal layer ID from the table above. Use canonical digits without
  leading zeroes. The optional lowercase `m` means mask. No default-layer form:
  `walk.png`, `walk_m.png`, missing IDs and unknown IDs are errors.
- `icon.png` and `data.json` are item metadata, not animation components.
- All animation images use four direction rows: north, east, south, west (NESW).
  `animations.json` and SQLite explicitly store `directions: "NESW"`; no other order is accepted. Animation metadata
  supplies frame count; image dimensions must divide into uniform frame cells.
  Corresponding drawing/mask sheets must share the animation's frame geometry.
- Indexed drawing images share the item's palette index mapping. Index 0 means
  nothing; colors occupy 1..N, with transparent pixels excluded from editable
  colors. Never sort, deduplicate or remap the GPL entries. Repeated RGB values
  may have distinct color names and indexes. The importer rejects embedded PNG
  palettes that disagree with the referenced GPL.

`sprites.layer` stores the required positive integer. `sprites.mask` is 0 or 1.
For a drawing it names the drawing level; for a mask it names the target level.
Import/renderer validation checks membership in this contract; there is no SQL
lookup table or catalog-wide uniqueness constraint on layer.

## GPL palette records

`palettes(id, name, data)` stores the filename stem, required GPL `Name:` value,
and the full original UTF-8 GPL text. Comments, spacing, line endings, `Columns:`
and color names are preserved. No JSON color array is persisted. Colors are parsed
for validation and runtime recoloring; named colors have no automatic material
semantics. The View uses SQLite GPL names, defaults each item to its own palette,
and offers alternatives with the same palette index count. Only slots containing
items have palette rows. PNG decoding preserves indexes even for duplicate RGB
entries; never recover indexes by matching decoded RGB pixels.

GPL requires `GIMP Palette` on the first line, one nonempty `Name:`, optional
`Columns:` (0–256), comments starting with `#`, and 1–255 RGB entries (0–255).
Color names are optional and may contain spaces. Metadata precedes entries.
The 255-color limit reserves PNG index 0; GPL has no alpha channel. Item drawing
palettes must match both the RGB order and number of visible GPL entries.
Binary mask palettes remain independent and never reference GPL files.

## Composition and conflicts

For one active animation and the selected items:

1. Resolve normal components and validate their explicit layer IDs.
2. If two different equipped items/slots draw on the same layer, throw an error
   naming the animation, layer and both slot/item IDs **before painting**. No
   priority, fallback, last-writer-wins or slot-derived tie-breaker exists yet.
   Catalog alternatives may share a layer; the conflict is composition-specific.
3. Draw normal components into separate layer buffers.
4. Apply binary masks to their target buffers: 0/black means keep, 1/white means
   erase. Masks use their own binary indexes, never the item's color palette.
   Multiple masks combine deletion; masks do not claim drawing occupancy. A mask
   on a valid but currently empty target has nothing to erase.
5. Composite buffers in ascending numeric layer order. Never erase from the
   already-flattened character; a hair mask must not remove its face or clothing.

## Current implementation boundary

The View reads slots, items, icons, sprites, GPL palettes and animations from
SQLite through shared Host `/util/sql.js` on every reload/Reset. The catalog
helper validates references, indexed PNG palettes, binary masks, NESW geometry
and timing, then composes separate drawing buffers and target masks as above.
Reset clears decoded/render caches; no schema/data writes, FS reads or runtime
fixture fallback occurs.

The folder importer validates prepared inputs before inserting records.
`make catalog-fixtures` prepares one real body Walk item; `make database` imports
the tree and generates [[animations|Project animations]] from those normalized
NESW sheets. The default sample has no masks. Historical raw clips, north-only
Climb and static poses remain offline research/preparation inputs, not automatic
runtime selections. Additional normalized imports remain separate work.

## LPC research

The Universal LPC generator sorts draw calls by ascending `zPos` and supports
multiple layers for one item. Its data includes body 10, legs 20, basic boots 25,
suspenders 38, bowtie 90, head 100, beard 110, front hair 120, and back/front cape
5/85. These facts informed this initial contract; this is not a promise of full
compatibility with its asset definitions or with Ultima Online equipment layers.

Upstream reuses some z-positions across different categories (for example
backpacks and beards at 110), unlike our deliberately strict occupancy rule.
We do not import its default z-position or its keyed-color masking behavior.

Research pinned to commit `9bf06be193b053db256b2536824af426de046aa2`:

- [Render ordering](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/9bf06be193b053db256b2536824af426de046aa2/ARCHITECTURE.md#render-path)
- [Layer-position inventory](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/9bf06be193b053db256b2536824af426de046aa2/scripts/zPositioning/z_positions.csv)
- [Multi-layer definitions](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/9bf06be193b053db256b2536824af426de046aa2/CONTRIBUTING.md)
