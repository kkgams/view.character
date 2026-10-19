---
title: Project animations
status: reference
---

# Project animations

## Animations

| ID | Name | Directions | Frames | Image |
| --- | --- | --- | --- | --- |
| `climb` | Climb | N | 6 | ![Climb](content/images/animations/climb.gif) |
| `combat_1h_backslash` | Combat 1h - Backslash | N, W, S, E | 12 | ![Combat 1h - Backslash](content/images/animations/combat_1h_backslash.gif) |
| `combat_1h_halfslash` | Combat 1h - Halfslash | N, W, S, E | 6 | ![Combat 1h - Halfslash](content/images/animations/combat_1h_halfslash.gif) |
| `combat_1h_idle` | Combat 1h - Idle | N, W, S, E | 2 | ![Combat 1h - Idle](content/images/animations/combat_1h_idle.gif) |
| `combat_1h_slash` | Combat 1h - Slash | N, W, S, E | 7 | ![Combat 1h - Slash](content/images/animations/combat_1h_slash.gif) |
| `idle` | Idle | N, W, S, E | 3 | ![Idle](content/images/animations/idle.gif) |
| `jump` | Jump | N, W, S, E | 6 | ![Jump](content/images/animations/jump.gif) |
| `legacy_swing` | Legacy - Swing | N, W, S, E | 6 | ![Legacy - Swing](content/images/animations/legacy_swing.gif) |
| `run` | Run | N, W, S, E | 8 | ![Run](content/images/animations/run.gif) |
| `walk` | Walk | N, W, S, E | 8 | ![Walk](content/images/animations/walk.gif) |

## Static poses

| ID | Pose | Directions | Frames | Source / column | Image |
| --- | --- | --- | --- | --- | --- |
| `emote_0` | Emote pose 1 | N, W, S, E | 1 | emotes / 0 | ![Emote pose 1](content/images/animations/emote_0.png) |
| `emote_1` | Emote pose 2 | N, W, S, E | 1 | emotes / 1 | ![Emote pose 2](content/images/animations/emote_1.png) |
| `emote_2` | Arms raised | N, W, S, E | 1 | emotes / 2 | ![Arms raised](content/images/animations/emote_2.png) |
| `emote_3` | Bow | N, W, S, E | 1 | emotes / 3 | ![Bow](content/images/animations/emote_3.png) |
| `sit_0` | Ground sit | N, W, S, E | 1 | sitting / 0 | ![Ground sit](content/images/animations/sit_0.png) |
| `sit_1` | Cross-legged sit | N, W, S, E | 1 | sitting / 1 | ![Cross-legged sit](content/images/animations/sit_1.png) |
| `sit_2` | Chair sit | N, W, S, E | 1 | sitting / 2 | ![Chair sit](content/images/animations/sit_2.png) |

Directions: **N** north, **W** west, **S** south, **E** east. Directions list source
coverage; the thumbnails show south, except north-only Climb. Source columns are
zero-based. **Frames** counts source frames per direction, not the total across
directions or repeated playback steps. For example, Idle has 3 source frames but
plays 0,1,2,1. Each pose has **1 frame**, exported as a static PNG, not a playback cycle.

## Current selection

The Project selects **10 animation clips and 7 static
poses** from 12 source sheet pairs in `scripts/lpc-animations.json`. Animation
names come from the built database; pose names come from the preparation manifest.
Only the ten animation clips are seeded into SQLite's animation registry. The
View reads the seven pose definitions from the prepared motion fixture; no pose
SQL table or persistent character state is introduced.

Emotes contains four body postures; Sitting contains three alternative seated
postures. They are not treated as frames of a combined animation. Pose names are
descriptive Project labels, not upstream canonical names or claims of specific
emotions. The first two Emotes columns deliberately retain neutral numbered names.
The tables follow Project manifest order, not a universal physical layout.
`make database` regenerates both tables and their previews.

The previews contain only the selected masculine-thin body and masculine head,
at native **64×64** size, without image borders, hair, clothing or equipment.
Climb has only a north-facing source row; the other previews face south. Heads
are already aligned in the source sheets and must not receive placement offsets
a second time.

The View previews all selected clips from their own source cells and holds each
pose on one source column. Play is disabled for poses. Compatible equipped parts
render and play even when other parts lack the selected source cells/facing.
Unsupported parts stay equipped but are omitted from composition, marked with
theme danger intent in equipment/inventory, and named in status. No Idle or other
pose substitution occurs. Climb is
north-only. Prepare this data with `make motion-fixtures` (also part of `make fixtures`).
Database sprite BLOB playback, indexed importing and pose persistence remain
separate work. Research entries are not automatically adopted.

## Source and preview timing

Current source: `justgook/LPC-rework`, revision `3d14b9715136dede36de55907b1b2d720a8ff306` — a pinned LPC Revised-derived
source set. This identifies this selection, not a universal format for all LPC eras.

Idle uses source-guide sequence 0,1,2,1; known Walk/Run/combat guide holds are
rounded to GIF centiseconds. `climb`, `combat_1h_halfslash`, `jump`, `legacy_swing` use **illustrative 100ms pose cycles**,
not claimed authored gameplay timing. Jump is phase-dependent. Static poses
have no playback sequence, FPS or loop. Preview timing is not the Project's
future animation contract.

For the complete researched inventory, historical families, source-specific
orders, frame layouts and conversion caveats, see
[[animation-reference|LPC sources, history and format reference]]. Use that page
to identify an incoming sheet's source family/version before extracting or
converting it. Changes to this Project's selection and target format are explicit
decisions, not automatic normalization of every LPC source.

## Attribution — artwork is not Apache-2.0

These body/head preview derivatives are **OGA-BY 3.0**:

- Body: Stephen Challener (Redshrike), Durrani, Eliza Wyatt (DeathsDarling),
  BenCreating, Salvador Oblea Jr. (joblea).
- Head: Stephen Challener (Redshrike), Eliza Wyatt (DeathsDarling),
  Salvador Oblea Jr. (joblea).

Changes: body/head compositing, frame extraction and GIF sequencing/timing.
No recoloring; native pixel dimensions retained.

- [Retained original credits](content/images/animations/credits-characters.txt)
- [Retained OGA-BY 3.0 license](content/images/animations/OGA-BY-3.0.txt)
- [Pinned source credits](https://github.com/justgook/LPC-rework/blob/3d14b9715136dede36de55907b1b2d720a8ff306/Characters/Credits.txt)

Other researched assets have their own license/author chains on the
[[animation-reference|reference page]] and in `assets/lpc/ATTRIBUTION.md`.
