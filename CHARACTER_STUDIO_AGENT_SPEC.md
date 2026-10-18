# GAMS Character Studio — Agent Implementation Brief

**Status:** Draft for iteration, not a frozen specification
**Primary goal:** An editor-first, general-purpose modular 2D character asset system, with LPC as the first imported asset family.
**Storage choice for v1:** Indexed PNG for eligible pixel data; JSON metadata and reference-based character documents.
**Non-goals for v1:** Custom image codecs, optimized export formats, embeddings/vector database, cloud services, or a prescribed GAMS Project Unit topology.

> **Instructions to implementation agent**
>
> Treat this file as design intent and an incremental implementation guide, not permission to refactor GAMS Host. Inspect the actual repository contracts and existing Project Unit patterns before coding. Keep implementations modular, but **do not create new Project Units, repositories, WASM components, or Host APIs just because they are named as conceptual subsystems below**. Prefer the smallest coherent working slice in the integration location selected by the project owner. Surface conflicts with existing conventions instead of silently inventing new ones. Preserve source assets and attribution. Keep v1 data readable and migration-friendly.

## Current scope and next data-model direction

The numbered sections below preserve the original broader Studio draft. The
following current workspace decisions take precedence; the older persistence,
asset-editing and recipe phases are not acceptance criteria for `view.character`.

- **View:** a catalog browser and transient character composer. It consumes one
  selected catalog read-only; changing catalogs/reloading discards session state.
  No asset CRUD, catalog-building UI or persistent character documents here.
- **Preparation:** external scripts author and validate catalogs. Development
  uses readable `scripts/catalog.sql` as an unversioned baseline. `make database`
  builds a real SQLite `db.sqlite` artifact ahead of time, not a custom binary
  format. Foreign keys/integrity are checked before atomic file replacement.
- **Pre-alpha development:** no version records, migration registry, history or
  Goose dependency. Initial mount and View reload/Reset query the existing file,
  never replay SQL or wipe its schema/data. Rebuild only while the Project/preview
  is closed, then reopen it; open connections do not follow atomic replacement.
  The baseline seeds `slots(id, name, icon, order)` and animation names. There is
  no layers table; fixed numeric definitions live in `docs/layers.md` and the
  renderer. Layer ID directly means paint order, independent of slot. Editor slots are read in SQL
  sort order, laid out left/right then top/down; their names and icons supply UI
  labels, tooltips and empty previews. Artwork/palettes still use mock fixtures;
  each fixture carries its explicit numeric layer for sorting.
- **First catalog tables:** `palettes(id, data)` stores a JSON color array;
  `items(id, name, slot, icon, palette)` references a slot and required default
  palette, with indexed-PNG icon bytes; `animations(id, name)` lists animations;
  `sprites(id, item, animation, layer, mask, data)` stores image bytes, a required
  positive integer layer, and a 0/1 integer mask flag (default 0). Foreign keys and storage/container constraints are
  enforced. Items/palettes/sprites are currently empty; the animation name
  registry is seeded for the selector. Indexed-PNG/per-color validation belongs
  to preparation. Multiple sprite rows per item/animation are allowed. Mandatory
  future filenames are `<animation_id>_<layer_id>[m].png`; unknown/missing IDs
  fail. A mask's layer is its target, not an occupied drawing level. Database
  sprite playback, the folder importer and frame mapping remain future work.
- **Animation UI slice:** SQLite supplies all names/IDs to the side-panel select,
  next to the moved Play button. Existing Idle fixture playback remains available;
  other names are selectable but disabled for playback until actual sprite data
  is wired. Empty registries disable both controls. No database animation frame
  mapping or fabricated non-Idle playback is introduced in this step.
- **Composition:** one selectable asset/variant may resolve to multiple render
  components (for example back/front hair). A slot choice must not imply one PNG
  or one draw pass. Two equipped items drawing on the same numeric layer fail
  before compositing; priority/tie-breaking is deferred. The current single-image
  fixtures do not yet model multi-component items.
- **Masks:** headwear may supply masks targeting hair components. Resolve these
  as explicit scoped composition effects; do not erase unrelated layers from
  the already flattened character or mutate source artwork. Binary masks use
  0/black=keep and 1/white=erase, share animation frame geometry, and apply to
  separate target-layer buffers before compositing. Raster implementation is
  still deferred; see `docs/layers.md` for the accepted contract.
- **SQL setup:** `gams.json` registers published `plugin.sql` v0.2.0 and opens
  `db.sqlite` as an ordinary file. Consumers use Host `/util/sql.js`; the View
  only reads catalog metadata. The SQL build input is outside packaged View
  source; no runtime migration helper remains. Native file-backed startup still
  needs an owner smoke check. Production read-only enforcement is separate work.

## 1. Product intent and principles

Build an editor in which users can:

1. Browse and search *parts* (bodies, hairstyles, clothing, weapons, accessories, effects) without traversing large nested folders.
2. Assemble a layered character from compatible parts, preview poses/animations, and change pieces quickly.
3. Recolor individual semantic regions of a part (e.g., robe fabric versus trim), without duplicating images for every color variant.
4. Save characters as small **references to assets plus choices and overrides**, not rendered sprite copies.
5. Create or edit *recipes* (e.g., `mage`, `orcish mage`) that find matching parts, make weighted randomized selections, respect compatibility, and provide repeatable results.
6. Import LPC assets first, while keeping the core data model independent of LPC naming, dimensions, animations, and body conventions.

Design priorities, in order: **usable editing workflow > correct composition and provenance > extensibility > compression optimizations**.

### Explicit scope boundaries

- **In scope:** logical asset model, taxonomy, metadata, import/validation, catalog/search, semantic palettes, composition, basic recipe generation, persistence, minimal preview UI.
- **Deferred:** embeddings, natural-language query parsing with LLMs, automatic AI tagging, perceptual image similarity, cross-pack deduplication, bespoke binary packers, runtime/game rendering APIs, sophisticated exports.
- **Integration left open:** which existing GAMS Project Unit(s) host editor, catalog, rendering, and persistence. These are *logical responsibilities*, **not** mandatory units or package names. Do not modify GAMS Host just to satisfy this draft.

## 2. Core domain terms

Use consistent naming; avoid conflating these:

| Term | Meaning |
|---|---|
| **Asset family** | A source convention/adapter, e.g., LPC, another sprite system. |
| **Asset pack** | Installable/versioned collection of assets and metadata, with provenance and dependencies. |
| **Asset** | Stable logical item such as a robe design. |
| **Asset variant** | Explicit geometry/animation/body variant of an asset; not just a color change. |
| **Part** | An asset/variant chosen into a character composition. |
| **Slot** | Semantic attachment role (e.g., `body`, `torso`, `headwear`, `main_hand`); defined by a **composition profile**, not hardcoded globally. |
| **Composition profile** | Defines canvas/coordinate system, available slots, poses, frames, directions, anchors, layer/order rules, and compatibility vocabulary. |
| **Frame source** | Actual pixel/frame data (initially PNG plus a frame map). |
| **Palette ramp** | Ordered shades for a semantic material/region, e.g., shadow/base/highlight. |
| **Palette slot** | Recolorable region (`cloth.primary`, `cloth.trim`, `skin`, `hair`) belonging to an asset. |
| **Palette preset** | Named set of ramp/color assignments reusable across parts/characters. |
| **Character document** | Saved composition referencing exact selected assets and their overrides. |
| **Recipe** | Rules for selecting parts and palettes to generate a character. |
| **Resolved character** | Concrete selected part IDs, variants, and overrides resulting from manual editing or generation. |

**Identity rule:** separate stable machine IDs from editable display labels. IDs must be namespaced by pack/family or another globally unambiguous mechanism. Version/lock information is required to reproduce characters when packs change.

## 3. Categorization model (critical)

**Never use a single folder tree as the canonical classification.** An asset can belong to many concepts. Separate orthogonal fields:

| Axis | Example | Purpose |
|---|---|---|
| `slot` (controlled, profile-specific) | `torso`, `headwear`, `back`, `main_hand` | Which composition role it fills; may be multiple candidates. |
| `kind` (controlled) | `robe`, `hood`, `hair`, `staff`, `armor` | What it visually is. |
| `tags` (extensible controlled vocabulary) | `mage`, `tribal`, `royal`, `necromancer` | Discovery, style, archetypes. |
| `material` | `cloth`, `leather`, `metal`, `bone` | Search and recolor defaults. |
| `style` / `theme` | `fantasy`, `ornate`, `worn`, `ceremonial` | Descriptive ranking. |
| `culture` / `faction` (optional) | `orcish`, `elven` | Aesthetic intent, not necessarily species constraint. |
| `profile` (hard) | `humanoid.64` | Coordinate/rig and frame compatibility. |
| `body_compatibility` (hard when specified) | `adult`, `child`, `broad` | Alignment restrictions. |
| `supported_animations` (hard when required) | `idle`, `walk`, `cast` | Whether required frames exist. |
| `palette_slots` | `cloth.primary`, `cloth.trim` | Targeted recolor affordances. |
| `source` / `license` | author, license ID, origin | Attribution and export compliance. |

### Taxonomy implementation rules

- Provide a **versioned taxonomy registry** with canonical IDs, labels, and aliases/synonyms (e.g., `wizard` -> `mage`; `hat` not always equivalent to `headwear`).
- Distinguish **structural facts** (`slot`, `profile`, supported animations) from **descriptive labels** (`mystical`, `evil`, `wealthy`). Hard requirements may never be satisfied by fuzzy similarity alone.
- Support `tags` as multiple values; do not generate combinatorial enum categories such as `orc_mage_robe_dark`.
- Namespaces and extension tags should be possible, e.g., `lpc:...` or `packname:...`, while common kinds and slots remain queryable across packs.
- Store display labels and descriptions separately so localization is possible later. Searching should not depend on file naming.
- Avoid inferring semantic facts from graphics alone when unclear; importing should allow `unknown` plus a review flag.
- Provide an extensible metadata field for source-specific details, but do not let LPC-specific fields leak into core query semantics.

### Example normalized asset metadata (illustrative, revise with actual importer)

```json
{
  "schema": "gams.sprite-asset/v1",
  "id": "lpc-basic:robe.long.01",
  "pack": "lpc-basic",
  "display_name": "Long Robe",
  "kind": "robe",
  "slots": ["torso"],
  "tags": ["mage", "ceremonial", "fantasy"],
  "materials": ["cloth"],
  "styles": ["plain"],
  "profile": "lpc:humanoid-standard-v1",
  "compatibility": {
    "body_types": ["adult"],
    "animations": ["idle", "walk", "cast"],
    "excludes": []
  },
  "art": {
    "source": "images/robe-long.png",
    "frame_map": "frame-maps/robe-long.json",
    "indexed": true
  },
  "palette_slots": ["cloth.primary", "cloth.trim"],
  "provenance": {
    "source_url": null,
    "authors": [],
    "license": null,
    "review_required": true
  }
}
```

This represents a *manifest*, not a guarantee the sample LPC item/frames actually exist. Do not ship fabricated attribution or treat null licenses as permission to redistribute.

## 4. Composition profiles and layer model

Core must support family-specific composition through profiles. A profile should describe:

- Canvas dimensions/units; origin, anchors and coordinate conventions.
- Slots, slot multiplicity, parent/attachment relationships, and optional required slots.
- Pose/animation definitions, named directions, frame counts/timing, and frame-to-source mapping.
- Per-pose/per-direction render order; optionally one part rendered in multiple passes (e.g., held weapon behind/front of body).
- Body/shape compatibility and slot-level exclusions/dependencies.
- Validation behavior for absent animations and frame alignment. **Do not silently display wrong frames**; show an actionable warning.

**Important:** `slot` is not automatically a draw order. Do not assume all humanoids share the same slots, number of limbs, or four cardinal directions.

Example composition flow:

```text
Profile + Character Document
        -> Resolve referenced assets/variants
        -> Validate profile, body, animation, dependencies, conflicts
        -> Build ordered render plan for selected animation/frame/direction
        -> Resolve semantic palettes and pixels
        -> Composite preview (nearest-neighbor for pixel art)
```

## 5. Palette and image representation

### v1 source format

- Retain imported **original artwork** without destructive conversion.
- Use **indexed PNG** for assets that can be represented losslessly with palette indices; PNG palette entries are RGB, with optional transparency via `tRNS`. Choose available bit depths (1/2/4/8) according to palette size.
- An RGBA fallback is mandatory for assets with unsuitable gradients/alpha/too many colors. Do not discard assets just because they are not indexed.
- Treat colors and semantic palette roles as separate concerns: **two different materials may share an RGB value** but must still be independently recolorable.
- Since indexed PNG by itself **cannot identify semantic regions** when identical source colors belong to different materials, import must capture explicit per-pixel semantic assignments (e.g., index remapping, slot masks, or segmented layers). Do not claim semantic recolor capability merely from having indexed PNG.
- The imported asset should record whether semantic slots are `authored`, `inferred` or `unmapped` so editor capabilities are truthful.
- Palette replacements should be non-destructive references/overrides. Cache rendered previews but do not save preview copies as the canonical character.

### Ramp semantics

Each recolorable material uses an ordered shade ramp such as `shadow`, `base`, `highlight` (or numeric shade indices for more flexible art). Support mapping between ramps with differing shades by an explicit lookup/interpolation policy, not arbitrary RGB-wide replacement.

Example character override:

```json
{
  "slot": "torso",
  "asset": "lpc-basic:robe.long.01",
  "palette": {
    "cloth.primary": "palette:purple.deep",
    "cloth.trim": "palette:metal.bronze"
  }
}
```

### Deferred optimization

No custom `.sprite` binary or QOI pipeline in MVP. Benchmark later using representative assets: original PNG, indexed PNG, raw indexed indices + Zstd, packed 4-bit indices + Zstd, cropped frames, frame deltas. Track disk size **and** random-frame decode time, RAM, and editor preview latency. Keep codec implementation below the asset API.

## 6. Reference-based character documents

Characters store concrete selections, not flattened sprites.

```json
{
  "schema": "gams.character/v1",
  "id": "npc.orc.mage.001",
  "profile": "lpc:humanoid-standard-v1",
  "pack_locks": {
    "lpc-basic": "1.0.0"
  },
  "composition": [
    {
      "slot": "body",
      "asset": "lpc-basic:body.orc.01",
      "variant": "adult",
      "palette": {"skin": "palette:skin.olive"}
    },
    {
      "slot": "torso",
      "asset": "lpc-basic:robe.long.01",
      "palette": {"cloth.primary": "palette:purple.deep"}
    }
  ],
  "generation": {
    "recipe": "recipes:orcish-mage",
    "recipe_version": 1,
    "seed": 482917
  }
}
```

- **Resolved part IDs are authoritative.** Regenerating must be an explicit action.
- `generation` is optional and documents provenance; manually composed characters are valid.
- When a referenced asset or pack is unavailable, show a missing-dependency state; never quietly substitute a random asset.
- Define `pack_locks` version/hash semantics explicitly before promising byte-for-byte reproducibility. An index alone is not sufficient if source files change in place.
- Preserve unknown extension fields when reasonably possible, or provide schema migrations rather than silently deleting them.

## 7. Catalog, indexing, tagging, and search

### v1 search behavior

Search must work **without embeddings and without cloud access**.

- Index `id`, name, aliases, canonical `kind`, `tags`, materials, style/theme, slot, profile, supported animations, compatible body types, and optionally provenance fields.
- Support immediate free-text search *and* faceted filters. Repeated facet values should be discoverable from the catalog itself.
- Match exact IDs and labels, prefix/substring terms, synonyms, and simple token combinations; weight canonical field matches over weak tag matches.
- Treat hard constraints (`profile`, required animation, forbidden conflicts) as filters, not low-scored suggestions.
- Return `asset_id`, display information, compatibility status/reasons, preview source, matched fields, and a deterministic score/sort key.
- Support empty query (“browse all”), zero-results states, stable pagination, and filters combined with text terms.
- Provide editable user-facing tags/aliases with a distinction between imported metadata and local overrides so catalog re-imports do not erase curation.

### Proposed normalized query contract

```json
{
  "text": "orcish mage robe",
  "filters": {
    "slots": ["torso"],
    "profile": "lpc:humanoid-standard-v1",
    "required_animations": ["walk", "cast"],
    "excluded_tags": ["heavy_armor"]
  },
  "prefer": {
    "tags": ["mage", "orcish"],
    "materials": ["cloth"]
  },
  "sort": "relevance",
  "limit": 50,
  "offset": 0
}
```

**Semantics:** `filters` are mandatory constraints; `prefer` influences ranking and recipe weighting; `text` is descriptive retrieval. Decide whether filters within an axis are OR or AND and document it. Suggested default: OR within `slots` and tags lists, AND across axes; `required_animations` means ALL listed animations.

### Suggested implementation

Begin with an in-memory index or a lightweight local index appropriate to catalog scale and existing GAMS dependencies. Avoid committing to a new database prematurely. Abstract catalog read/query/update so storage can evolve independently.

Add a small shared taxonomy/alias registry and include test examples like `wizard -> mage`, `headgear -> headwear`, while avoiding unsafe synonyms that incorrectly imply compatibility.

### Tagging workflow

- On import: retain source metadata, map known source fields into canonical tags, mark ambiguous mappings for review.
- In editor: user can add/remove tags and aliases, preview impacts on search, and distinguish local overrides from source-pack defaults.
- Validate structural fields separately: tags are not allowed to bypass profile/slot requirements.
- Persist curated metadata separately from source art, or provide a clear merge strategy on re-import.

## 8. Recipe-based random character generator

Recipes are **search constraints + preferences + weighted picks + compatibility validation**; they are not collections of pre-rendered characters.

### Recipe model

- A recipe may inherit from or compose named traits, e.g., `mage` + `orcish` + `veteran`.
- Define explicit precedence when traits conflict; hard constraints always win over aesthetic preferences.
- Each step chooses from catalog candidates matching a query and compatibility state.
- Choices have weights/probabilities, optional chance-to-skip, required status, and dependencies/exclusions.
- Allow pinned/locked slots: users can keep hair/face/body and reroll everything else.
- Use a specified seeded PRNG and a stable iteration/sorting order so identical **recipe version + asset pack locks + seed + locked slots** produces the same result.
- Save the **resolved concrete selections** in the character document; recipe information is history, not a live dependency for rendering.
- Failed candidate selection returns diagnostics (e.g., missing cast frames) and a user-visible fallback/skip decision. Do not spin indefinitely or silently choose incompatible art.

Example recipe (illustrative):

```json
{
  "schema": "gams.character-recipe/v1",
  "id": "recipes:orcish-mage",
  "version": 1,
  "inherits": ["recipes:mage"],
  "constraints": {
    "profile": "lpc:humanoid-standard-v1",
    "required_animations": ["idle", "walk", "cast"],
    "species": "orc"
  },
  "steps": [
    {
      "slot": "torso",
      "query": {
        "filters": {"slots": ["torso"]},
        "prefer": {"tags": ["robe", "tribal", "mage"]}
      },
      "required": true
    },
    {
      "slot": "headwear",
      "query": {"prefer": {"tags": ["hood", "shaman"]}},
      "chance": 0.7
    }
  ],
  "palette_preferences": {
    "skin": ["palette:skin.olive", "palette:skin.moss"],
    "cloth.primary": ["palette:purple.deep", "palette:brown.earth"]
  }
}
```

`species` above is a **proposal for a typed trait/constraint**, not permission to assume every profile defines it. Core needs extension-safe trait semantics.

### Minimum generator UI

- Pick a recipe; preview generated character.
- `Randomize all`, `Randomize unlocked`, and per-slot reroll.
- Lock/unlock each slot and palette assignment.
- Display selected parts and which constraints/preferences selected them.
- Make any generated character manually editable without keeping a recipe engine running.

## 9. Future semantic search (design seam only)

**Do not implement embeddings in the first version.** Keep a pluggable *retrieval/ranking* interface in which structured search always executes compatibility filters. Later providers can add:

- Text embeddings on human-friendly asset descriptions and tags.
- Optional image similarity using previews, only after testing pixel-art retrieval quality.
- Natural-language-to-structured-query interpretation (local rules or optional LLM), with the resulting query inspectable/editable by the user.

Never use embedding scores to overrule invalid slots, missing required animations, license restrictions, or body/profile conflicts. Plan for provenance of semantic index versions, opt-in model downloads/services, and a deterministic non-AI fallback.

## 10. LPC adapter — first integration target

Import a **small known-good subset**, not the entire LPC ecosystem at once:

- One compatible body variant and a few head/hair/torso/weapon parts.
- At least `idle`, `walk`, and one more useful animation *where legitimately supported by chosen assets*; do not fabricate missing animations.
- Direction-specific frame maps and draw ordering.
- Semantic palette slot mapping for at least one multi-material part (robe fabric vs trim).
- Original source filenames/paths, source URLs, author/license details retained faithfully.

Adapter maps source naming, frame layout, authorship and metadata into core `SpriteAsset` + `CompositionProfile`; do not spread LPC conventions throughout the search, character document, or generator code.

## 11. Editor UX: minimum useful experience

A simple layout is sufficient:

```text
+---------------------------------------------------------+
| Search assets ...    [Slot] [Kind] [Style] [Compatible]   |
|---------------------------------------------------------|
| Asset list       | Character preview | Selected parts    |
| thumbnail/name   | pose/direction    | layers + locks    |
| tags/compat      | play/pause        | palette controls  |
|                 |                   | randomize / save  |
+---------------------------------------------------------+
```

Prioritize interaction speed and transparency:

- Selecting a slot auto-filters compatible candidates; incompatible items may be visible with reasons when requested.
- Clicking an asset previews it without destructively changing the character; selection can be confirmed/reverted.
- Recolor each **semantic palette slot** independently; show the available shade ramps.
- Provide undo/redo for part changes and palette overrides.
- Preview direction and animation. Render pixel art without blurry scaling.
- Missing dependencies, incomplete mappings, absent animation frames, and license metadata gaps should be visible.
- Search, manual assembly, and recipe generation all operate over **the same catalog**.

## 12. Persistence, validation, and licensing

- Validate manifests, profile IDs, IDs/references, frame maps, palette bindings, recipe queries, and compatibility on load/import.
- Preserve provenance **per source asset**, not only per character. Record original license, attribution, source URL, and source-pack version. Different LPC-derived assets may have different obligations.
- Do not ship assets or previews lacking distribution permission merely because they were present in a third-party generator.
- Keep editing state and asset source data separate. Character saves must not overwrite source PNGs.
- Provide clear schema versions and small migrations rather than letting fields drift silently.
- No image or asset upload to a remote server is required for local search or generation.

## 13. Implementation sequence and acceptance tests

### Phase A — contracts and fixtures

- Write schemas/types for `AssetPack`, `SpriteAsset`, `CompositionProfile`, `PaletteDefinition`, `CharacterDocument`, `AssetQuery`, and `CharacterRecipe`.
- Create tiny **legally usable** sample assets and manifests; keep fixtures small enough for tests.
- Implement validation and fixture loading.

**Done when:** invalid IDs, missing frames, ambiguous palette slots, and unresolvable references produce actionable errors; basic fixtures load consistently.

### Phase B — render and recolor

- Resolve asset references, compose ordered frames, and preview a character.
- Import/render indexed PNG; support RGBA fallback.
- Implement at least two separate semantic palette slots on one asset and demonstrate recoloring one doesn't change the other.

**Done when:** a character can be reconstructed from JSON, all supported directions align, and recoloring never mutates original assets.

### Phase C — browse, search and editing

- Build the smallest editor surface, catalog query engine, tag/alias handling, compatibility feedback and palette controls.
- Save and reopen a character with resolved part references and palette overrides.

**Done when:** the user can find a robe by `mage`/`wizard`, filter compatible assets, choose it, recolor it, save and reload with an identical preview.

### Phase D — first recipe

- Add deterministic `mage` and derived `orcish-mage` recipes, locks and per-slot reroll.
- Include recipe validation, selection diagnostics, and tests for exclusion/animation conflicts.

**Done when:** identical seed + exact locked pack versions + identical inputs reproduces selections, and invalid combinations are never silently accepted.

### Phase E — optional improvements (only after feedback)

- Additional asset families; scalable catalog backend; richer tagging UX; advanced animation and compatibility; compression benchmarks; embeddings/semantic retrieval.

### Required automated tests

1. Indexed-PNG decode and transparency; non-indexed RGBA fallback.
2. Semantic recoloring across overlapping source RGB values.
3. Rendering order by direction/pose, including behind/in-front passes.
4. Save/load round trip preserving resolved references and palette overrides.
5. Query hard-filter correctness, synonyms, zero results, stable scoring.
6. Recipe determinism, slot locking, impossible constraints, and no infinite retries.
7. Missing pack/asset/license information surfaced clearly.
8. Migration/version handling for at least one schema change fixture.

## 14. Open design choices — ask owner or document ADRs

Do **not** make these architectural decisions implicitly:

- Exact GAMS integration location and Project Unit split (owner has ideas; this brief intentionally does not prescribe it).
- Asset pack installation/version resolution and lockfile format, based on actual GAMS facilities.
- Whether source PNGs remain untouched and semantic region maps are sidecars, or importer emits normalized derived images alongside originals. Default: retain originals and store mapping metadata separately.
- Catalog persistence technology (in-memory, SQLite, etc.) after measuring size.
- Taxonomy registry stewardship: core canonical IDs vs pack-specific namespaces and user tag aliases.
- Recipe conflict-resolution rules and deterministic PRNG specification.
- First LPC source pack selection and exact license obligations.

## 15. First task for the coding agent

1. Inspect current GAMS repo patterns and owner-selected integration point; **do not refactor Host or add Project Units yet**.
2. Propose a concise file/module layout scoped to that point, including data contracts and tests.
3. Implement Phase A and the smallest Phase B vertical slice: load a sample manifest, decode/render a layered character with one direction/animation, and recolor two semantic regions independently.
4. Add a small test proving the persisted character is reference-based and renderer output is deterministic.
5. Report decisions, deferred work, unresolved compatibility questions, and any missing license information for owner review before expanding scope.

**Definition of success:** A generic reusable data model that can assemble an LPC character today without forcing future sprite families, recipes, or search features to become LPC-specific or to depend on one image compression codec.
