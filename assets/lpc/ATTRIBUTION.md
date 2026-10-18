# LPC research assets — not Apache-2.0

These files are an **independent research collection**, not a runtime catalog or
production import. They are excluded from the code-only View archive. Do not
relicense this directory under the repository's software license. Preserve this
file, the relevant source credits, license texts and `animations.json` when
redistributing selected assets. Production integration needs a separate choice
of permitted license and review of its obligations; this collection is not legal
clearance for an entire upstream repository or asset pack.

## Exact per-file records

`animations.json` → `assets[]` records the original URL, SHA256, original/archive
filename, source revision, authors, license alternatives, license evidence and
local location **for every retained downloaded file**. `mirrors` is reserved for
byte-identical alternative sources; different animations/body variants are not
deduplicated by name. The files are unchanged, not recolored, normalized or
quantized. Extracted archive members retain their original bytes.

| Local group | Contributors / license evidence |
| --- | --- |
| `original/style-guide/` | Stephen Challener (Redshrike), all eight selected character templates explicitly enumerated in [AUTHORS](sources/style-guide/AUTHORS). [COPYING](sources/style-guide/COPYING): CC-BY-SA 3.0 or GPL 3.0. |
| `original/unified/` | Redshrike: walk/hurt/slash/spellcast; Johannes Sjölund (wulax): male thrust/shoot; Matthew Krohn: female thrust/shoot adaptations. See pinned [AUTHORS.txt](sources/legacy-unified/AUTHORS.txt) and [README](sources/legacy-unified/README.md). CC-BY-SA 3.0 or GPL 3.0. |
| `extended/universal/spritesheets/body/` | Full contributor chains in the retained [body.json](sources/universal/sheet_definitions/body/body.json). Includes Redshrike, wulax, Durrani, MuffinElZangano, TheraHedwig, Eliza Wyatt, BenCreating, Evert, bluecarrot16, JaidynReiman; female record also pvigier and makrohn. OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 alternatives for these selected male/female records. No rights are inferred for pregnant/muscular assets. |
| `extended/universal/spritesheets/weapon/` | wulax and bluecarrot16; retained [longsword metadata](sources/universal/sheet_definitions/weapons/sword/weapon_sword_longsword.json). OGA-BY 3.0 or CC-BY-SA 3.0. |
| `extended/revised/` | Stephen Challener (Redshrike), Eliza Wyatt (DeathsDarling); Durrani and BenCreating additionally for jump. See exact [character credits](sources/revised/characters-credits.txt) and [root credits](sources/revised/Credits.txt). Selected feminine-thin body/feminine head and guide assets: OGA-BY 3.0. |
| `extended/jump-2019/` | Durrani, Redshrike, BenCreating, MuffinElZangano; aligned 64px-grid version. [Original submission and alignment comment](https://opengameart.org/content/lpc-male-jumping-animation-by-durrani). CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0 as listed. |
| `extended/jump-2021/` | Durrani, Redshrike, BenCreating, Eliza Wyatt (DeathsDarling), MuffinElZangano. Only the adult female base is retained; no license inference for other archive members. [Jump expanded](https://opengameart.org/content/lpc-jump-expanded): CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0. |
| `extended/expanded/` | Stephen Challener, Eliza Wyatt, Durrani, BenCreating, David Conway Jr. (JaidynReiman). [Expanded author statement](https://opengameart.org/content/lpc-expanded-sit-run-jump-more): OGA-BY 3.0 / OGA-BY 4.0. Only the named female sample is collected. |
| `community/push_and_carry.zip` and extracted members | Evert's original pack, with Redshrike, wulax, Manuel Riecke (MrBeast), Joe White, Michael Whitlock (bigbeargames), makrohn, Daniel Eddeland (daneeklu), bluecarrot16 and JaidynReiman as appropriate. The unchanged [pack README](community/push%20and%20carry/README) gives the per-component chain. [Submission](https://opengameart.org/content/lpc-character-animations-push-and-carry): CC-BY-SA 3.0 or GPL 3.0; **no OGA-BY permission is inferred** from comments about other body assets. |
| `sources/universal/` software/evidence | Universal LPC contributors; software GPL 3.0, retained [LICENSE](sources/universal/LICENSE). Artwork licensing is separately defined by per-asset metadata. |
| `sources/style-guide/` software/evidence | Original LPC contributors, retained AUTHORS and COPYING; demo code headers specify GPL 3.0 or later. |

The ZIP's preview and clothing belong to its stated contributor chains; copying
only the two body PNGs does not authorize dropping their inherited credits.
License alternatives are recorded as stated, not silently upgraded to newer
versions. No asset is selected merely because a collection or repository has a
permissive-looking top-level license.

## Retained license texts

- [OGA-BY 3.0](sources/licenses/OGA-BY-3.0.txt)
- [OGA-BY 4.0](sources/licenses/OGA-BY-4.0.txt)
- [CC-BY-SA 3.0 legalcode](sources/licenses/CC-BY-SA-3.0.html)
- [GPL 3.0](sources/licenses/GPL-3.0.txt)

OGA-BY/CC attribution requires credit and license information, with modifications
identified. CC-BY-SA derivative/share-alike requirements and the GPL alternative
have different conditions. No claim that all these alternatives suit every
engine, delivery channel or project is made here. The existing unrelated
facial-hair fixture attribution issue remains unresolved and outside this set.
