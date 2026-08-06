# Roadmap — bring R20Exporter up to date

**Goal:** an export that is **complete** (no silently missing assets), **honest**
(every miss is counted and reported), and **current** (works on today's Roll20
engine and today's Chrome), feeding R20Converter 1.7.x without the recovery
work the converter currently does on the exporter's behalf.

**1.0.0 is MVP1**, and its scope is exactly that sentence: *a complete, honest,
current export*. Nothing else ships in it. Specifically **not** in MVP1: the
derived-value oracle (exploratory, depends on Roll20's sheet workers — see
Post-MVP), Firefox, and any architecture rewrite. A research task in the critical
path of a 1.0.0 is how a 1.0.0 never ships.

**Nothing downstream is waiting on this.** *Curse of Strahd* is the next export
and it can wait for 1.0.0, so this roadmap optimises for correctness over speed.
Had it been urgent, R1+R2 alone would have been enough to export safely.

**Viability verdict: yes, updating is viable — and worth it.** The hard
existential work is already done: the extension was ported to Manifest V3
(0.11.0) and partial support for the new Roll20 engine ("Jumpgate") exists
(`path.points`, `doors`, `windows` are exported). The converter demonstrably
consumes recent exports — its `src/entities/scenes.py` and `actors.py` branch on
`campaign["release"] == "jumpgate"` and were field-tested in 2026. What remains
is reliability and modernization, not resurrection.

## Design principle — the export is the immutable oracle

Every time the downstream pipeline needed ground truth — pre-migration weapon
payloads, stripped-art audits, "is this a converter defect?" — the answer came
from **raw exported values**. An exporter that "helpfully" cleans data destroys
the only witness. Therefore:

> **Add information; never normalise it away. Sidecars and manifests, not
> transformations.**

Concretely: `Campaign.toJSON()` output ships verbatim. All new intelligence —
integrity checks, hashes, derived values, failure records — goes into
**sidecar files** the converter may ignore.

> ⚠ **Precision matters here.** `campaign.json` is *not* pure `Campaign.toJSON()`
> output — the exporter already adds its own `R20Exporter_format` stamp to it.
> The invariant is therefore: **no Roll20-sourced field is ever added, removed,
> reordered or rewritten.** The exporter's own stamp is the one exception, and it
> is how a consumer detects that sidecars are present.

## Code reality — what already works, and must not be "fixed"

Read before planning any step. Three of the obvious-looking fixes are already
implemented, and a fourth is subtler than it appears:

| Already present | Where | So the real gap is |
|---|---|---|
| Legacy-host rewrite `s3.amazonaws.com/files.d20.io/` → `files.d20.io/` | **both** `downloadResource` and `downloadR20Resource` | It is **duplicated**, **one-way** (a rewrite, not a fallback ladder), and covers **one** host form. Not missing — insufficient. |
| Resolution ladder `original → max → med → thumb` | `downloadR20Resource` | Only call sites that route through it get it; `downloadResource` callers do not. |
| Canvas re-encode fallback | `downloadR20Resource`, after the ladder is exhausted | It writes the blob under the **original** extension (`ext` is parsed from the source URL), so a canvas PNG lands as `.webp`. That is the GH #11 class. |
| Retry with exponential backoff; 403/404 short-circuit via `DO_NOT_RETRY` | `downloadResource` | Correct as designed — a 403 falls through to the *next resolution variant*. It does **not** fall through to another *host*. |
| Operation accounting: `newPendingOperation` / `completedOperation` | class-wide | A counter already exists. **The report should hang off it**, not reinvent it. Terminal failure currently ends at `console.log(…)` + `finallyCB()` — that is the silent miss. |

## Context (August 2026)

- Roll20's new tabletop engine left beta January 2025; since November 2025 it is
  simply "the engine" and old games are tagged **Legacy**. Both populations
  exist, so the exporter must keep working on both.
- The exporter reads Roll20's page internals: the Backbone `Campaign` global,
  `BackboneFirebase`, `window.is_gm`, `window.d20_player_id`. These still exist,
  but they are an **unversioned private API**. That dependency is the one risk
  we cannot engineer away — only detect early (see R1).

## What the field data says about us

Evidence from R20Converter's `docs/bugs/` and post-conversion repair work,
measured on real campaigns:

| Evidence | Upstream implication |
|---|---|
| **116 referenced assets absent** from one export zip — **112 of the 115 real misses still downloadable** at conversion time (3 genuinely dead, 1 a degenerate 0 × 0 graphic); exporter exit was "success" (Conv-B049) | Downloads fail silently — `errorCB` chains end in `finallyCB()` with at most a console line. No accounting, no manifest. |
| Legacy-host art rot: `s3.amazonaws.com/files.d20.io` 403s while the **same objects** serve from `files.d20.io`; 139 of 208 external refs dead on one campaign; 280 images stripped as "dead" across three others (Conv-B048) | The export's asset record is URL-shaped, and URLs rot. Bundled **bytes + hashes + observed variant URLs** make rot detectable instead of inferred. |
| **914 scene tokens** across three worlds pointed at characters deleted before export; one battle map had 22 of 22 tokens dead; found months after shipping | Tokens are copied blind (`page.thegraphics.toJSON()`); `represents` is never resolved against the character list. Only the exporter sees both sides of that reference at export time. |
| Two scenes exported with `graphics: 0` **and** a thumbnail showing a real map; 25 MB of maps recovered only by URL-variant rewriting | A silently empty page is indistinguishable from a legitimately empty one. The contradiction is detectable at export time. |
| The only per-character oracle for "is this weapon right" was a **manually exported PDF**; a double-count bug (`1d12+3` printed, `1d12+6` rolled) hid behind its absence | The export should carry its own oracle: computed to-hit, damage, AC, HP, DCs per character at export time. |
| 366 chat messages carry `null` rolls that throw on world load | **Flag in a manifest, don't repair.** Altering the payload destroys the witness. |
| ZIP creation fails on large campaigns (`QuotaExceededError`, GH #23); "keep the tab focused or it takes hours" | Save path is deprecated `webkitRequestFileSystem(TEMPORARY, 4 GB)` + zip.js from 2013 + FileSaver from 2014, all main-thread. |
| Exports stall at "Saving Characters" (GH #34) | `loadCharacterAttributes` awaits Firebase `once('value')` with no timeout; one hung reference stalls the run. |
| Canvas-fallback downloads re-encode to PNG but keep the original extension (GH #11 class) | Record `canvas-reencoded` honestly; store under the true type. |

## Conventions

Same as R20Converter's roadmap: **R1–Rx** are steps, one per release (minor
versions through the ladder, with the final step cutting **1.0.0**); **B/F**
numbers for bugs and fixes; every bug gets a regression test (or, where the
behavior only exists inside Roll20's page, a recorded fixture) before its fix is
accepted. Each step has a gate, and **a step is not done until its gate is
measured** — not argued. Converter bug records are cited as `Conv-B048` etc. to
keep the trackers distinct.

## Steps

| Step | Version | Title | Roll20-sourced fields changed? | Status |
|---|---|---|:--:|---|
| **R1** | 0.12.0 | Ground truth — manifests, loud failures, engine guard | No (sidecars only) | **Delivered** 6 Aug 2026 |
| **R2** | 0.13.0 | Asset completeness — host + resolution ladder, hashes, honest types | No | **Delivered** 6 Aug 2026 |
| **R3** | 0.14.0 | Storage & scale — OPFS, modern zip.js, worker compression | No | |
| **R4** | 0.15.0 | Robust character export + MV3 cleanup | No | |
| **R5** | **1.0.0** | **MVP1 — acceptance against the real converter** | No | |
| — | post-1.0 | The oracle · Firefox · architecture | deferred, see Post-MVP | |

**The MVP1 line is drawn after R5 deliberately.** R1–R4 are bounded engineering
against known defects, each with a measurable gate; R5 adds nothing and only
proves them. The derived-value oracle, which an earlier draft placed inside
1.0.0, is *research* — how much a sheet exposes differs per template and may be
unreadable for some — and research cannot gate a release.

---

### R1 · 0.12.0 — Ground truth

Before fixing downloads, make failure **visible**. This mirrors the converter's
own lesson: its 455-green suite missed bugs that a single measured run exposed.
Everything here is a sidecar; **no Roll20-sourced field in `campaign.json` is
touched** (see the precision note under the design principle — the file is not
pure `Campaign.toJSON()` output, because the exporter's own stamp lives in it).

- **`export_report.json`**: every referenced asset URL with its outcome —
  `bundled`, `bundled-lower-res`, `canvas-reencoded`, or `failed` with reason
  and HTTP status — plus per-collection counts (pages, characters, handouts,
  tracks, tables) and totals at the top. The Conv-B049 campaign would have said
  "116 failed" instead of nothing.
- **`integrity.json`** — the referential-integrity manifest: dangling
  `represents` ids (token → character resolved against the exported character
  list), links to deleted handouts/characters, chat messages with unusable
  (`null`) roll payloads — **flagged, never repaired** — and page-level
  contradictions (`graphics: 0` while a page thumbnail exists).
- **`index.json`** — reference index: every Roll20 id → `{type, name}` across
  all collections. Downstream link rewriting becomes a lookup instead of the
  current reverse-engineered `base64(sha256(id)[-12:])` trick.
- **Sheet template identity**: record the campaign's character-sheet template
  (OGL / Shaped / other, as Roll20 reports it) in the report. Interpretation of
  every `attribs` field depends on it; downstream should never guess.
- **Failure surfacing in the UI**: the final dialog states the miss count and
  keeps the log visible when non-zero, instead of auto-closing on
  "Congratulations".
- **Engine guard**: on startup, assert the page globals we depend on
  (`Campaign`, `BackboneFirebase`, `window.is_gm`) and their minimal shapes; if
  Roll20 changes internals, fail with one clear message rather than a
  half-written zip.
- **Non-vacuity guard — the check that catches "we didn't know that existed".**
  A report of what we *attempted* reads as success when a collection is never
  enumerated at all. So compare per-collection counts against the **live**
  `Campaign` collections (`Campaign.characters.models.length`, page
  `thegraphics`, handouts, jukebox, tables) and fail when our tally and the
  page's disagree. Downstream shipped "all 0 artwork paths exist on disk —
  PASS" for several releases for exactly this reason; do not repeat it.
- **Determinism, scoped to what we control.** Two exports of an unchanged
  campaign **cannot** be byte-identical: `campaign.json` carries server-side
  volatile state that moves on its own — measured on a real campaign,
  `lastmodified`, `legacySignallingUsedAt`, `webrtcOnlinePlayers`,
  `lastFogConversionInitiated`, `instance_id`, `turnorder`, `playerpageid`,
  `videopos`, plus per-page `force_lighting_refresh` and `jumpgate_hex_updated`.
  So: **stable ordering of sidecar entries and zip members, pinned zip entry
  mtimes, and a committed `volatile-fields.json` mask** used by the diff. A gate
  that fails for reasons outside our control gets switched off, which is worse
  than no gate.

*Deliberately excluded:* text-encoding fixes (U+2028 et al.). The one confirmed
world-load breakage was traced downstream — the converter's `json.dumps`
escapes it correctly; a JS repair tool re-emitted it raw. Fixing it here would
be fixing the wrong component *and* transforming the record.

**Gate:** report totals match a hand count on a known campaign · report totals
match the live `Campaign` collection lengths · integrity manifest finds a
deliberately dangling token in a fixture campaign · zero-miss export auto-closes
exactly as today · two consecutive exports of an unchanged campaign differ only
in masked volatile fields.

**Gate result — measured 6 Aug 2026.** All five hold. Offline: 28 tests green
(`npm test`), including the planted dangling token, the pinned zip timestamps
and the two-export diff through `tools/diff-exports.js`. Live, on *The Sunless
Citadel* (Jumpgate, 21830677): the engine guard passes with nothing missing and
nothing degraded, and every collection matches the live page exactly — 30
characters, 54 handouts, 4 pages, 287 graphics, 305 paths, 2 players, 2 decks,
**0 mismatches**. The integrity manifest found one real dangling journal link
in the shipped module. Sheet template `ogl5e`, read from the page.

**Amendments made while building R1:**

- **The non-vacuity guard is loud, not fatal.** The step as written said "fail
  when our tally and the page's disagree". Aborting a two-hour export because a
  player uploaded a token mid-run is user-hostile, and the export is still the
  best record available. So at runtime the mismatch is counted, written to the
  report and shown in red, and the dialog stays open; as an offline *gate* a
  mismatch fails the suite. Only the **engine guard** is fatal, and it runs
  before any work is done.
- **Two page APIs were dropped rather than guarded.** `parseCampaign` used
  `Array.prototype.all` and `.count`, which are Roll20 page extensions, not
  standard JS. They still exist today (verified live) but they are one more
  unversioned dependency for no benefit; `.every` and `.filter().length`
  replace them.
- **Optional collections degrade instead of throwing.** `Campaign.pdfs`,
  `.decks`, `.rollabletables` and `Jukebox` are now optional; a missing one is
  reported as a degradation in the report rather than taking the export down.
- **The sheet template comes from the page.** `charsheettype` is not a campaign
  field on today's Roll20 (verified: the campaign carries 35 keys and none of
  them name a sheet). `CharacterSheetsManagerSingleton.sheets` is, and it also
  reveals when *several* sheets are in use. Campaign fields and the
  `character_sheet` character attribute remain as offline fallbacks.

---

### R2 · 0.13.0 — Asset completeness

Close Conv-B048/Conv-B049 at the source. The exporter already fetches asset
**bytes** into the zip, already rewrites the legacy host, and already walks the
resolution ladder — see *Code reality*. The gap is narrower and more specific
than "add asset downloading": misses are silent, the host rewrite is one-way,
and the record is URL-shaped. Target: **every asset either bundled or in the
report with a reason** — B049 showed **112 of the 115 real misses (97%)** were still
downloadable at conversion time.

- Promote the existing one-way host rewrite to a **fallback ladder** in **one**
  shared helper called by both `downloadResource` and `downloadR20Resource`
  (today the same `replace()` is duplicated in both). Order it
  `files.d20.io` → legacy `s3.amazonaws.com/…` → staging, and **pin that order
  to the converter's `hostCandidates`** — if the two components disagree about
  which host to try first, an asset looks dead in one tool and alive in the
  other, which is precisely the confusion B048 caused.
- Route every Roll20-CDN call site through the resolution ladder, not just the
  `downloadR20Resource` ones. This is what recovered Dragoncoast's blank scenes
  (`/thumb.jpg` → `/original.jpg`).
- **Per-asset provenance in the report**: sha256 of the stored bytes, byte
  length, *which* host+variant actually served, and **every candidate tried** —
  so future rot is detectable against a recorded baseline instead of inferred by
  re-probing.
- Canvas fallback: derive the extension from the **blob's** type rather than the
  source URL, and record `canvas-reencoded`. Today `ext` is parsed from the
  original URL, so a re-encoded PNG is stored as `.webp`.
- Retry policy: 403/404 is final only after **all** host × variant candidates —
  currently `DO_NOT_RETRY` ends the variant walk but never tries another host.
- URLs inside `campaign.json` stay **unmodified** — the oracle principle, and
  the converter matches assets by original URL.

**Gate:** re-export a campaign with known legacy-host assets · zero `failed`
entries that a manual fetch can retrieve · every stored asset has a hash and a
served-from URL · zip diff against 0.12.0 shows **only additions and
higher-resolution replacements, each one listed in the report** — a replacement
changes bytes, so "only gained" would be the wrong assertion.

**Gate result — measured 6 Aug 2026.** *The Sunless Citadel*, full asset run:
**499 assets, 498 bundled, 1 failed**, 66.6 MB, 158 s. Every asset was served
at the `original` resolution from `files.d20.io`; every stored asset carries a
sha256 (183 distinct hashes across 498 files — the module reuses art heavily)
and the URL that answered. The single failure is genuinely dead: 33 attempts
across three hosts, four resolutions and the canvas fallback, all 404. The
legacy-host recovery path is covered offline by a fixture asset that answers
**only** under the `s3.amazonaws.com` spelling.

**Amendment — the canvas fallback keeps the URL's extension.** R2 as written
said "store under the true type". Measured against the consumer, that loses the
asset: `R20Converter.copyZipFile` derives the expected zip member name from the
asset URL's extension, fails to find a `.png` member for a `.webp` URL, and
then falls back to downloading a URL that is dead — which is exactly why the
canvas path ran. The file therefore keeps the URL-derived name and the report
carries the real `content_type` with `outcome: "canvas-reencoded"`. GH #11
becomes documented rather than silent. See ADR-003.

**Amendment — one rewrite had to be deleted, not extended.** The host rewrite
inside `downloadResource` silently undid every legacy-host candidate the ladder
produced (B003). Two layers choosing the host is how the original defect
survived two releases; there is now exactly one.

---

### R3 · 0.14.0 — Storage & scale

Replace the 2013-era save pipeline. Deliberately **after** R1/R2: correctness
first, then plumbing, so the report harness can prove the new pipeline loses
nothing.

- `window.webkitRequestFileSystem(TEMPORARY, 4 GB)` → **OPFS**
  (`navigator.storage.getDirectory()`) — standard, quota-manageable, not
  deprecated. Fixes the `QuotaExceededError` class (GH #23).
- zip.js 2013 → current **@zip.js/zip.js**: Zip64 (campaigns > 4 GB), streamed
  writes, **web-worker compression** — which also addresses "keep this tab
  focused or it takes hours", since workers escape background-tab throttling.
- FileSaver 2014 → `showSaveFilePicker` with a `saveAs`-style fallback.
- Zip **layout stays byte-compatible**: same folders, same filenames. The
  converter's `getZipFile` path handling is the contract.

**Gate:** a synthetic campaign exceeding the old 4 GB ceiling exports without
quota errors — no real campaign has come close (see sizing note), so this is
built deliberately by padding assets rather than waited for · zip opens in the
converter unchanged · **R1's report is identical before and after the migration
on the same campaign** (the plumbing changed, the contents must not) · an export
in a backgrounded tab completes unattended.

> Sizing note: the largest campaigns observed downstream are **2,965 MB** and
> **2,390 MB**, both of which export successfully on the current pipeline. The
> 4 GB `TEMPORARY` quota — not typical campaign size — is the ceiling being
> raised here. This step is a latent-defect fix, not a blocker for any known
> export, which is also why it is the first thing to defer if 1.0.0 slips.

---

### R4 · 0.15.0 — Robust character export + MV3 cleanup

- `loadCharacterAttributes`: per-character timeout + bounded retry on the
  Firebase `once('value')` await, per-character progress, and an
  `attributes-incomplete` report entry when a character couldn't be fully
  loaded — a stall becomes a counted degradation, not a hung export (GH #34).
  This matters doubly because the converter's PC pipeline (Conv-B050) reads
  `base_level` and friends from exactly these raw attribs.
- Raw `attribs` continue to ship verbatim (they already do —
  `character.attribs.toJSON()`); the report records per-character attribute
  counts so a partial load is visible.
- Content-script modernization: replace the five-deep `loadScript` chain with a
  `world: "MAIN"` content script — fewer moving parts, no
  `web_accessible_resources` for our own code. **This is now insurance, not
  tidying:** the editor sends
  `script-src 'self' 'unsafe-eval' 'nonce-…' https://cdn.roll20.net blob:`, and
  the current design depends on Chrome exempting web-accessible extension
  resources from that policy. A `world: "MAIN"` script is injected by the
  browser and never subject to page CSP, so it removes the dependency entirely.
- Audit the implicit **jQuery** dependency (we use the page's `$`); confirm
  both engine variants ship it on our injection path or vendor a minimal
  replacement for the modal.
- Verified export matrix: one **Legacy** game, one **current-engine** game.
  Current-engine specifics (`points`, `doors`, `windows`, x/y) checked against
  what the converter's `scenes.py` expects.

**Gate:** both matrix exports convert with zero `Cannot find file … in Zip`
warnings · a deliberately-hung Firebase ref (mocked) degrades to a report
entry, not a stall.

---

### R5 · 1.0.0 — MVP1: acceptance

Measured, not asserted — the converter's own acceptance discipline applied to
us. This step adds **no features**. It proves the previous four on real data, or
it fails and sends work back.

- Export a real, asset-heavy campaign on today's Roll20 with 0.15.0.
- Run it through R20Converter (current release) and its verification tooling
  (`tools/verify_dnd5e.py` where applicable).
- Compare against the Conv-B049 baseline: the class of campaign that once
  shipped **116 silent misses — 112 of them recoverable** must ship **0**, or
  list every miss with a human-checkable reason.
- Re-run the R4 export matrix (one Legacy game, one current-engine game) on the
  final build.
- README refresh documenting the sidecars and how to read `export_report.json`.

**Gate (all four must hold):** converter run completes with zero
exporter-attributable warnings · report totals match the zip's actual contents
*and* the live campaign's collection counts · a deliberately dangling token and
a deliberately unreachable asset both appear in the manifests · both matrix
exports convert clean.

> **Chrome Web Store submission is a milestone, not a gate.** Review is an
> external dependency with unpredictable latency; blocking the engineering
> definition of done on someone else's queue makes "done" unfalsifiable. Ship
> the tag when the four gates pass; submit in parallel.

---

## Post-MVP — deliberately after 1.0.0

### The oracle: per-character derived-value snapshot

The export carries its own ground truth: per character, a sidecar
(`oracle/<character>.json`) with computed **to-hit, damage totals, AC, HP, save
DCs** as the Roll20 sheet computes them at export time. This would replace the
manually-exported-PDF oracle and turn bugs like the LMoP double-count
(`1d12+3` printed, `1d12+6` rolled) into a two-line downstream gate.

**Why it is not in MVP1:** the derivation lives in Roll20's sheet workers, and
how much is readable (computed attribs vs rendered sheet) differs by template —
OGL, Shaped, and others each behave differently, and some fields may not be
readable at all. That is a research task with an unknown answer, and an unknown
answer cannot sit in the critical path of a 1.0.0.

When it is picked up: OGL first, Shaped second, best-effort per field with a
per-value `source` tag (`computed-attrib` / `sheet-dom` / `unavailable`). An
unavailable value is recorded as unavailable — **never computed by us from
scratch**, or the oracle would ratify our own assumptions, which is exactly the
failure mode the converter's verify tooling exists to avoid.

**Until this ships, exporting the PC sheets as PDF remains mandatory** — they
are the only per-character oracle, and they cannot be recovered once a campaign
is gone.

### Also deferred

- **Firefox support** — OPFS now exists there, so the historical storage blocker
  is gone, but a second review/test pipeline isn't justified until Chrome is
  sound.
- **Architecture rewrite** (TypeScript, bundler) — zero user value until the
  above ships.

---

## Explicit non-goals

- **Any transformation of exported data.** No text-encoding "fixes", no repair
  of null roll payloads, no restructuring toward Foundry's schema. The moment
  the export models the target, it stops being a neutral record of the Roll20
  campaign. Everything we add is a sidecar.
- **Fixing conversion-side semantics** — sheet parsing, dnd5e schemas, NPC stat
  blocks (GH #20) are the converter's domain; our contract ends at "a complete,
  honest zip".
- **The oracle, Firefox and any rewrite** — not cut, *deferred*; see Post-MVP.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Roll20's CSP stops allowing extension-injected `<script src=chrome-extension://…>`** | Medium — the editor already sends a strict `script-src` (measured 6 Aug 2026) | R4's `world: "MAIN"` content script is injected by the browser and is not subject to page CSP. This moved R4 from cleanup to insurance; if the injection ever breaks, the extension is dead until it ships. |
| Roll20 removes/renames the Backbone `Campaign` global or `BackboneFirebase` | Medium, rising — private API under active engine development | R1 engine guard fails loudly; R4 matrix re-runs on engine updates. No full mitigation exists — this is the bet the whole tool makes. |
| **A campaign becomes unexportable before we get to it** (subscription lapse, deletion, Roll20 policy change) | Low per campaign, certain across a long enough horizon | The reason R1+R2 are first and additive: after 0.13.0 an export is *safe enough* even though the tool is not finished. Do not let a pending export wait for 1.0.0 if its campaign is at risk. |
| R3's storage migration silently changes zip layout or drops content | Low | R3's gate re-runs R1's report before and after and requires it identical; converter contract test. |
| Chrome Web Store review friction | Low | Manifest already MV3; changes are code-only. Submission is a milestone, not a release gate. |
| Oracle derived values unreadable for some sheet templates | Medium | Deferred out of MVP1 precisely so this uncertainty cannot delay 1.0.0. |
| EULA exposure (unchanged from README disclaimer) | — | Out of engineering scope; disclaimer stays. |

## Review — Senior Dev pass

The plan was reality-checked against the trenches before being accepted. Four
challenges landed and changed it; one was answered and did not.

| Challenge | Outcome |
|---|---|
| "Your 1.0.0 contains a research task. It'll never ship." | **Accepted.** The oracle moved to Post-MVP; 1.0.0 is now R1–R5, all bounded work with measurable gates. |
| "You're rewriting the save pipeline on a tool whose *only* job is not to lose data." | **Accepted, ordering kept.** R3 stays after R1/R2 so the report harness exists to prove losslessness — and R3's gate now requires R1's report to be **identical before and after**. |
| "Half your R2 bullets describe code that already exists. Read it first." | **Accepted, and it was worse than that** — host rewrite, resolution ladder and canvas fallback are all implemented. R2 was rewritten around the actual gaps, and a *Code reality* section now precedes the steps. |
| "A report of what you *tried* is green when you never tried." | **Accepted.** R1 gained the non-vacuity guard: our tally must match the live `Campaign` collection lengths. |
| "Why not just fix the U+2028 thing here while you're in the area?" | **Declined, with evidence.** It was traced downstream — the converter escapes it correctly and a JS repair tool re-emitted it raw. Fixing it here would be the wrong component *and* a transformation of the record. |

One open disagreement, recorded rather than resolved: the Senior Dev would drop
R3 from MVP1 entirely on the grounds that no observed campaign has hit the 4 GB
ceiling. It stays because `QuotaExceededError` is a **reported user-facing bug**
(GH #23) and "complete export" is meaningless for the users who cannot complete
one — but if 1.0.0 slips, R3 is the first candidate to defer.

## Review — Senior Dev pass, round 2 (6 Aug 2026, before the first line of code)

| Challenge | Outcome |
|---|---|
| "Every gate you wrote needs a live campaign and a human. In practice that means never measured." | **Accepted, and it changed R1's scope.** A synthetic-page harness runs the *shipped* code offline (ADR-002); Playwright against a real module is the acceptance gate, not the daily one. |
| "You're going to abort a two-hour export because a count moved?" | **Accepted.** The non-vacuity mismatch is loud and counted at runtime, fatal only as an offline gate. The engine guard stays fatal because it runs before any work. |
| "A report of what you *tried* is green when nothing ever resolved." | **Accepted.** An asset record that is never resolved counts as `pending` and is reported as a failure, not omitted. |
| "Hashing every asset on the main thread will freeze the tab." | **Partly accepted.** `crypto.subtle.digest` is off-thread and assets are individually small; measured 498 hashes inside a 158 s run with no stall. The hash holds a pending operation so the manifests cannot be written early. |
| "Your fixture will pass whatever you write. Plant the defects first." | **Accepted.** The fixture campaign ships a dangling token, a dead asset, a legacy-host-only asset, an empty page with a thumbnail and an unusable roll payload. The legacy-host fixture immediately caught B003 — the ladder would otherwise have shipped recovering nothing. |
| "Adding files to the zip root will break the converter's zip walk." | **Declined, with evidence.** `R20Converter.getZipFile` opens members by name and never enumerates the root; unknown members are inert. |

**Finding that outranks all of them, discovered on the first live run:** Roll20's
editor now serves a strict CSP —
`script-src 'self' 'unsafe-eval' 'nonce-…' https://cdn.roll20.net blob:`. That
makes R4's `world: "MAIN"` content script **load-bearing rather than cosmetic**;
see R4.

## Sources

- R20Converter: `ROADMAP.md`, `docs/adr/ADR-001…009`, `docs/bugs/B048, B049,
  B050, B052`, `src/R20Converter.py`, `src/entities/{base,scenes,actors}.py`
- R20Exporter: `src/R20Exporter.js`, `src/R20ContentScript.js`,
  `manifest.json`, git history through 0.11.0
- Downstream field feedback (2026-08): asset-rot and token-integrity audit
  across six shipped conversions; repair programme O8; gate G21.
- Roll20 engine status: [Jumpgate — Roll20 Help Center](https://help.roll20.net/hc/en-us/articles/21569402281495-Jumpgate),
  [2025 Change Log](https://help.roll20.net/hc/en-us/articles/38597501957015-2025-Change-Log)
- Exporter issue tracker: [GH issues #11, #23, #34](https://github.com/kakaroto/R20Exporter/issues)
