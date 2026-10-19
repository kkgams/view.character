---
title: Project animations
status: reference
---

# Project animations

| ID | Name | Frame size | Directions | Frames / direction | Image |
| --- | --- | --- | --- | --- | --- |
| `walk` | Walk | 64×64 | NESW | 8 | ![Walk](content/images/animations/catalog/walk.gif) |

## Current selection

Generated from the prepared catalog `animations.json` and verified SQLite records. The first import slice contains one body item, without head or clothing. All normalized sheets have north, east, south, west rows (NESW); the preview faces south. Frame indexes are zero-based. Original upstream NWSE sheets remain unchanged.

## Playback timing

- `walk`: sequence `[0, 1, 2, 3, 4, 5, 6, 7]`; durations (ms) `[100, 100, 100, 100, 100, 100, 100, 100]`. Upstream 30 FPS guide; rounded to GIF centiseconds.

## Attribution

Source: LPC Revised via the pinned LPC-rework checkout. Retain the [author credits](content/images/animations/catalog/credits-characters.txt), [OGA-BY 3.0 license](content/images/animations/catalog/OGA-BY-3.0.txt), and [source pins and modification record](content/images/animations/catalog/sources.json). The sample is for local development, not general production distribution approval.

## Other source animations

See [[animation-reference|LPC Animation Reference]] for the broader research inventory. Upstream clips and static poses are not automatically imported. View playback reads normalized SQLite sprites and database-defined NESW geometry, sequence and timing on each reload/Reset; raw motion fixtures remain offline preparation inputs.
