---
title: Project animations
status: reference
---

# Project animations

## Animations

$project_previews

## Static poses

$pose_previews

Directions: **N** north, **W** west, **S** south, **E** east. Directions list source
coverage; the thumbnails show south, except north-only Climb. Source columns are
zero-based. **Frames** counts source frames per direction, not the total across
directions or repeated playback steps. For example, Idle has 3 source frames but
plays 0,1,2,1. Each pose has **1 frame**, exported as a static PNG, not a playback cycle.

## Current selection

The Project selects **$animation_count animation clips and $pose_count static
poses** from 12 source sheet pairs in `scripts/lpc-animations.json`. Animation
names come from the built database; pose names come from the preparation manifest.
Only the ten animation clips are seeded into SQLite's animation registry. No
pose table or pose runtime is introduced by this documentation step.

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

**Selected does not mean runtime playback is implemented:** only the existing
Idle fixture is currently playable in the View. Importing sprites and connecting
database-driven playback remain separate work. No new animations are adopted
merely because they appear in the research catalog.

## Source and preview timing

Current source: `$repository`, revision `$revision` — a pinned LPC Revised-derived
source set. This identifies this selection, not a universal format for all LPC eras.

Idle uses source-guide sequence 0,1,2,1; known Walk/Run/combat guide holds are
rounded to GIF centiseconds. $illustrative use **illustrative 100ms pose cycles**,
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
- [Pinned source credits]($project_credits)

Other researched assets have their own license/author chains on the
[[animation-reference|reference page]] and in `assets/lpc/ATTRIBUTION.md`.
