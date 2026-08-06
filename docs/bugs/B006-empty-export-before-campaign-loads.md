# B006: An export started before the campaign has loaded silently produces an empty archive

- **Status**: **Fixed** in 0.15.0 — the engine guard refuses to start until the
  campaign has arrived, and the live counts are only trusted once they stop
  moving. Tests: `tests/characters.test.js`.
- **Severity**: **Critical** — the export succeeds, reports no problem, and
  contains nothing
- **Found**: 2026-08-06, opening *Curse of Strahd* (181 characters, 363
  handouts, 50 pages) with Playwright while building R4
- **Component**: `src/R20Exporter.js` (`checkEngine`, `parseCampaign`)
- **Related**: B001 — this is the vacuous-report case the non-vacuity guard was
  supposed to catch, and did not.

## Symptom

Immediately after the editor page reports `Campaign` present and usable:

```json
{"release":"jumpgate","characters":0,"handouts":0,"pages":0,
 "pdfs":0,"decks":0,"tables":0,"is_gm":true}
```

Roughly two minutes later, the same campaign reads:

```json
{"characters":181,"handouts":363,"pages":50,"decks":6,"tables":40}
```

An export started in that window writes a zip containing `campaign.json` with
empty collections, no characters, no journal, no pages — and reports success.

## Cause

Two independent failures that only combine into a disaster:

**1. The engine guard is satisfied by an empty collection.** It asserts that
`Campaign.characters.models` *is an array* — which it is, immediately, and it is
empty. Presence was checked; arrival was not.

**2. The non-vacuity guard compares two numbers taken from the same unloaded
page.** `exportedCollectionCounts` says 0 characters, `liveCollectionCounts`
says 0 characters, they agree, and the report shows `collection_mismatches: []`.

The guard added in R1 was designed against the case "we never enumerated a
collection we could have enumerated". It cannot see "the page has not received
the collection yet", because both sides of its comparison come from the page.

`parseCampaign` then makes it worse. Its first check is:

```js
const character_num_attributes = Campaign.characters.models.map((c) => c.attribs.length)
if (!character_num_attributes.every((n) => n > 0)) { …wait… }
```

For an empty campaign that array is `[]`, and **`[].every(…)` is `true`** — the
vacuous truth. So the "wait for character sheets to load" path, the one piece of
patience in the whole function, is skipped precisely when there is nothing
loaded at all.

## Evidence

Measured on *Curse of Strahd*, id 21852240, Jumpgate, as GM:

| moment | characters | handouts | pages | tables |
|---|---:|---:|---:|---:|
| `Campaign.characters` first exists | 0 | 0 | 0 | 0 |
| ~120 s later | 181 | 363 | 50 | 40 |

The loading overlay is still displayed in both samples, so "the page looks
ready" is not a signal either — `sheetsLoaded` was still 0 of 181 after the
collections had arrived.

Small campaigns hide this: *The Sunless Citadel* (30 characters, 4 pages)
populates fast enough that a human clicking a button never wins the race. The
bug scales with campaign size, which means it is worst exactly where an export
is most expensive to repeat.

## Fix

- `checkEngine` treats an empty `Campaign.pages` as *not ready* rather than as a
  valid campaign: Roll20 guarantees at least one page, so zero pages means the
  data has not arrived. The dialog says so and the export does not start.
- The live counts used by the non-vacuity guard are sampled only after the
  collection sizes have been **stable across consecutive samples**, so a still-
  filling campaign cannot be mistaken for a finished one.
- `parseCampaign` no longer treats an empty character list as "all sheets
  loaded"; the vacuous `every` is guarded by an explicit emptiness check.

## Regression test

`tests/characters.test.js` — "an export refuses to start while the campaign is
still arriving" drives a page whose collections are empty and asserts that
nothing is written; "live counts are only trusted once they stop moving" grows a
collection between samples and asserts the exporter waits.
