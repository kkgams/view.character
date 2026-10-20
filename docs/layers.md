---
title: Layer contract
status: reference
---

# Layer contract

Layer IDs are **any positive safe integer** and define numeric paint order:
lower numbers are behind higher numbers. There is no fixed layer inventory,
`layers` table, layer foreign key or separate render-order field. A slot does
not imply a layer. Duplicate drawing occupancy remains an error, not a priority
rule; masks do not claim drawing occupancy.

These user-approved runtime changes supersede earlier fixed-layer,
database-required animation geometry/timing and indexed-only expectations.

## SQL ordering and animation packs

SQL result ordering is the sole ordering authority. Slots use
`ORDER BY "order", id`; the View does not validate order values. Initial equipment
uses the first item in SQL result order in each nonempty slot; every slot may
unequip.

SQLite `animations` supplies only `id, name`. Temporary explicit
`animationSettings` at the top of `src/views/view-character.js` supplies frame
geometry, directions, sequence and timing. Frames last 100ms, except idle frames
at 400ms. Climb and hurt use S only; other supported animations use NESW.
Unsupported animation IDs fail visibly rather than inferring settings.

`selectAnimationPack(item, state, database = sql)` selects from SQL-ordered cached
`item.sheets` metadata: first body compatible with `state.body`, then every
drawing/mask row with that exact body value. It fetches raw sprite BLOB rows by
bound exact opaque primary-key IDs, using
`WHERE item = ? AND animation = ? AND body = ? AND id IN (...) ORDER BY id`
in chunks of at most 256 IDs. Missing or changed returned pack IDs fail loudly
and require Reset. Character body is temporarily `m`; never parse sprite ID
suffixes. Later body/pack policy changes belong only in `selectAnimationPack`,
with its signature unchanged. Unsupported equipped
parts are omitted with warnings, without invented frames or Idle substitutions.

## Image and palette records

Icons browser-decode the original supplied bytes in their original format and
size. There is no 32px, indexed-PNG or GPL assumption for icon data. The approved
CSS sizing of empty/remove UI icons is a separate, unchanged layout exception.

Sprite BLOBs are fetched and decoded lazily per selected animation/body pack.
Indexed PNG decoding preserves original indices, including duplicate RGB roles;
never recover indices by matching decoded RGB pixels. Other browser-supported
image formats decode to original RGBA with no fabricated palette indices and no
recoloring.

Indexed sprites default to their **original embedded palette**, not an assumed
exact match with GPL colors. Alternative recoloring requires an equal palette
index count; RGBA sprites remain unchanged. Mask colors are independent of item
palette selections.

`palettes(id, name, data)` stores the filename stem, required GPL `Name:` value,
and full original UTF-8 GPL text. Comments, spacing, line endings, `Columns:` and
color names are preserved. No JSON color array is persisted. Named colors have
no automatic material semantics.

GPL requires `GIMP Palette` on the first line, one nonempty `Name:`, optional
`Columns:` (0–256), comments starting with `#`, and 1–255 RGB entries (0–255).
Color names are optional and may contain spaces. Metadata precedes entries.
Transparent index 0 is implicit for parsed GPL alternatives; GPL has no alpha
channel. These GPL rules do not constrain supplied icon or RGBA image formats.

## Composition and conflicts

For one active animation and the selected packs:

1. Resolve every drawing/mask component and validate positive safe integer layers.
2. Detect duplicate drawing occupancy before painting. Conflicting equipped
   items/slots on one layer fail with the animation, layer and both slot/item
   IDs. No priority, fallback, last-writer-wins or slot-derived tie-breaker exists.
   Catalog alternatives may share a layer; the conflict is composition-specific.
3. Draw normal components into separate layer buffers using original pixels or
   a compatible indexed palette alternative.
4. Apply masks to their target drawing buffers: black keeps, opaque white erases.
   Masks use their own pixels, never the item's selected color palette. Multiple
   masks combine deletion; a mask on a currently empty target has nothing to erase.
5. Composite buffers in ascending numeric layer order. Never erase from the
   already-flattened character; a hair mask must not remove its face or clothing.

## SQLite input boundary

The View queries catalog metadata during reload/Reset in bounded pages through
Host `/util/sql.js`; selected-pack sprite BLOBs are lazy.
Item and sprite metadata use 512-row SQL keyset pages ordered by `id`, with
`WHERE id > ?` on subsequent pages, bounding native WIT/JSON response memory.
Other tables load in full. Names and ordering remain SQL-owned.
Equipment slot activation performs no SQL or character recomposition. Image
decoding remains capped at eight concurrent decoders. Reload invalidates pack, icon
and render caches and transient selections, never database records. Required
references and malformed state fail visibly; the View never creates or repairs
schema/data, reads catalog source folders or changes the Host. The producer owns
normalization and asset provenance; only SQLite records cross this boundary.
The deployable View remains one self-contained file. These changes do not alter
the approved View-local CSS or authorize a release.
