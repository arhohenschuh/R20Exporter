# B001: Asset download failures are silent

- **Status**: **Fixed** — counted and reported in 0.12.0, recovered in 0.13.0.
- **Severity**: High (silent; cost 116 assets on a single campaign)
- **Component**: `src/R20Exporter.js` (`downloadResource`, `downloadR20Resource`)
- **Related**: Conv-B048, Conv-B049, B003. Tests: `tests/export.test.js`, `tests/assets.test.js`.

## Symptom

An export finishes, says *"Congratulations! The Campaign.zip file was generated
successfully"*, auto-closes after ten seconds, and is missing assets. Converting
*Dragoncoast Danger* produced **116** `Cannot find file … in Zip` warnings; the
export had reported nothing. **112 of the 115 real misses (97%) were still
downloadable** at conversion time.

## Cause

Every terminal failure path ended in a `console.log` plus `finallyCB()`:

```js
this.console.log("Couldn't download ", url, " with any alternative filename. Resource has become unavailable")
finallyCB()
```

The class already counted work (`newPendingOperation` / `completedOperation`)
but nothing counted *outcomes*, so a miss was indistinguishable from an asset
that was never referenced. The final dialog reported success unconditionally.

## Fix

- `R20ExportReport` records every referenced asset with its outcome
  (`bundled`, `bundled-lower-res`, `canvas-reencoded`, `failed`, `skipped`) plus
  each attempt and its HTTP status, and is written to `export_report.json`
  (ADR-001).
- An asset record that is never resolved counts as `pending` and is reported as
  a failure — a report of what we *attempted* is green when we never attempted.
- The dialog no longer auto-closes when the failure count is non-zero; it lists
  the first ten misses and points at the report. A zero-miss export auto-closes
  exactly as before.
- 0.13.0 then made most of those misses recoverable (ADR-003).

## Evidence after the fix

*The Sunless Citadel*, exported 6 Aug 2026 with 0.13.0: 499 assets, 498
bundled, **1 failed** — reported with its reason, its 33 attempts and their
statuses.
