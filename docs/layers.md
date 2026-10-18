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
layers 9 and 120. Two outerwear alternatives may use different layers: the
current suspenders fixture explicitly uses 38, and the cardigan uses 55.

## Required fixture filenames

The planned item fixture format uses:

```text
fixtures/catalog/
  slots.json
  animations.json
  headwear/
    helmet/
      data.json
      icon.png
      walk_130.png
      walk_120m.png
      walk_9m.png
```

- `data.json` initially supplies the item name. Paths supply slot/item identity;
  the generated item ID is slot-qualified, such as `headwear/helmet`.
- `slots.json` supplies required slot names/icons/display order. Folder discovery
  can create slots, but missing required metadata is an error.
- `animations.json` supplies known animation IDs/names and frame definitions.
- Every animation image must be `<animation_id>_<layer_id>[m].png`, with a
  positive decimal layer ID from the table above. Use canonical digits without
  leading zeroes. The optional lowercase `m` means mask. No default-layer form:
  `walk.png`, `walk_m.png`, missing IDs and unknown IDs are errors.
- `icon.png` and `data.json` are item metadata, not animation components.
- All images use four direction rows: north, west, south, east. Animation metadata
  supplies frame count; image dimensions must divide into uniform frame cells.
  Corresponding drawing/mask sheets must share the animation's frame geometry.
- Indexed drawing images share the item's palette index mapping. Index 0 means
  nothing; colors occupy 1..N, with transparent pixels excluded from editable
  colors. Palette storage must retain this mapping rather than shift indexes.

`sprites.layer` stores the required positive integer. `sprites.mask` is 0 or 1.
For a drawing it names the drawing level; for a mask it names the target level.
Import/renderer validation checks membership in this contract; there is no SQL
lookup table or catalog-wide uniqueness constraint on layer.

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

The mock renderer now sorts explicit per-item numeric layers and rejects drawing
conflicts. Existing LPC fixture metadata carries those layer IDs; there is no
slot-to-layer default. Images and provenance are otherwise unchanged.

The folder importer, database-driven sprite playback and binary mask raster
composition are not implemented yet. The rules above define their contract;
`make database` currently builds schema and registry seeds, not this folder tree.

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
