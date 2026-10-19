---
title: Layer contract
status: reference
---

# Layer contract

Layer IDs **are numeric paint order**: lower numbers are behind higher numbers.
There is no `layers` database table, layer foreign key or separate render-order
field. Slot display order remains independent. A slot does not imply a layer.

This contract is enforced by `LAYERS` in `src/views/view-character.js`; tests
check that these definitions agree. Extend both deliberately when a new drawing
level is needed. Unknown IDs fail instead of receiving a default layer.

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
layers 9 and 120. A slot never determines drawing order; the database supplies explicit layers.

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

## SQLite input boundary

The View reads slots, items, icons, sprites, GPL palettes and animations through
Host `/util/sql.js` on reload/Reset. It validates required references, NESW
geometry, playback timing, palette indexes and binary masks. It never creates
schema or reads catalog source folders. The database producer owns normalization
and asset provenance; only the resulting SQLite records cross this boundary.
