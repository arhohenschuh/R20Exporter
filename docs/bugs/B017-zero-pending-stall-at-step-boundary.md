# B017: The campaign ZIP stalls at a step boundary with nothing pending

- **Status**: Fixed in 1.5.5 (2026-11-10)
- **Severity**: High - the export waits forever with no error, and every retained Blob ages meanwhile (B012)
- **Found**: 2026-11-10, B012 triage of the DotMM run that "stalled at several zero-pending state-machine boundaries"
- **Component**: `src/R20Exporter.js` (`completedOperation`, `_checkZipDone`, `downloadR20Resource`)
- **Related**: [B012](B012-retained-blobs-unreadable-at-finalization.md), [B009](B009-malformed-http-200-images-reported-bundled.md), [B016](B016-document-blob-failures-and-late-callbacks.md)

## Symptom

The export dialog stops moving between two save steps. It shows zero operations in
progress, no error is logged and no ZIP is written. The DotMM run behind B012 had to be
resumed by hand several times.

## Cause

The save phase is a callback state machine. `_checkZipDone()` advances to the next
step only when nothing is pending, and only `finallyCB` callbacks and step ends call it.
`completedOperation()` removed an operation without asking to advance. The design
therefore needs every operation to finish **before** the last `finallyCB` of its step.

`downloadR20Resource` breaks that rule. A stored candidate is validated under its own
pending operation (B009):

```js
const validationId = this.newPendingOperation("Validating image " + candidate.url)
this._validateImageBlob(blob)
    .then(() => this._storeAsset(...))
    .catch(() => next())                      // next() may run finallyCB()
    .finally(() => this.completedOperation(validationId))
```

If validation fails on the **last canvas candidate**, `next()` records the asset as
failed and calls `finallyCB()` while `validationId` is still pending, so nothing
happens. `.finally` then completes the operation with no continuation. If that asset
was the step's last open work, the export stays at zero pending operations forever.

A canvas fallback reaches validation with an unusable result when it receives a
0 × 0 image. The canvas is then empty and `toBlob()` yields `null`. Conv-B049 measured
such a degenerate graphic in a real campaign.

## Reproduction

`tests/staging.test.js` contains a deck whose only asset is a 0 × 0 graphic. Every
HTTP body decodes to zero pixels, and the canvas fallback yields `null`. Against
unchanged 1.5.4 source, the export never saves. The test times out with zero
pending operations.

## Resolution In 1.5.5

- `completedOperation()` asks the state machine to advance whenever pending work
  reaches zero, so completion order no longer matters.
- `_checkZipDone()` is idempotent. Only one advance can be scheduled. It re-checks
  pending work before running and reads `savingStep` at run time, in `_advanceZip()`.
  An operation started after scheduling postpones the step rather than running it early.
- The state machine is active only from `saveCampaignZip()` until finalization begins.
  The parse phase and JSON-only export keep their own continuations.

## Validation

- The 0 × 0 deck asset now ends `failed` with its canvas reason and a recorded
  validation error. The ZIP is delivered, and no asset is left `pending`.
- A step-count guard wraps every save step during a full export. Each step runs exactly
  once, the page step runs once per page plus one, and `_saveZipToFile` runs once.
- Full suite: 145 / 145.
