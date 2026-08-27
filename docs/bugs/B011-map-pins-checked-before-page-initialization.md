# B011: Map Pins are checked before archived pages initialize `mapPins`

- **Status**: **Fixed** in 1.4.1 - Pin gates run only after every page's Pin collection initialization completes
- **Severity**: Critical - 1.4.0 refuses valid current Jumpgate campaigns before export
- **Found**: 2026-08-27, live Playwright export of *Waterdeep - Dungeon of the Mad Mage*
- **Component**: `src/R20Exporter.js` (`parseCampaign`), `src/R20ExportManifests.js` (`checkEngineGlobals`, Pin collection discovery)
- **Related**: B006, B010

## Symptom

R20Exporter 1.4.0 reports:

```text
This version of R20Exporter does not understand this Roll20 page.
Missing or changed page internals: Campaign.pages.models[*].thepins (Map Pins)
```

The current DotMM campaign is valid and visibly contains Map Pins.

## Cause

The real Jumpgate model exposes Pins as `page.mapPins`, not `page.thepins`.
More importantly, archived pages do not own that collection until
`fullyLoadPage()` runs. Even then, `page.fullyLoaded` can become true before
`page.mapPins.initializationPromise` resolves and populates the records.

Version 1.4.0 called the all-page Pin availability gate from `checkEngine()`
before the existing archived-page loader ran. Its later wake condition also
named only `thepins`. A valid unloaded page therefore looked permanently
unsupported.

## Fix

- Keep the initial engine guard limited to campaign primitives available before page loading.
- Discover the measured `mapPins` name first while retaining compatible aliases.
- After archived page loading, require a Pin collection for every Jumpgate page.
- Await each collection's `initializationPromise` before Pin parity and reference closure.
- Use shared Pin discovery for the Pin-only page wake condition.
- Report collection initialization failures visibly without producing a ZIP.

## Evidence

Playwright loaded all 29 pages of campaign `21938012` and awaited every
`mapPins.initializationPromise`. The live result contains 1,620 unique Pins on
26 pages and 1,620 Handout references, with zero missing IDs, page mismatches,
or Handout-link mismatches. Level 1 alone contains 92 Pins; `38. Secret Tunnel`
preserves coordinates, text label `38`, linked Handout, and GM heading.
The exact built 1.4.1 browser runtime was injected into the same live page and
reported `pages.mapPins`, 1,620 Pins, and 1,620/1,620 reference closure PASS.

The live-shaped regression creates `mapPins` only when an archived page loads,
delays its record until `initializationPromise` resolves, and requires exact ZIP
preservation. The complete 1.4.1 source suite passes 73/73.