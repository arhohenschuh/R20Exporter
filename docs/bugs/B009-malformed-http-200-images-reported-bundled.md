# B009: Malformed HTTP 200 images are reported as successfully bundled

- **Status**: **Fixed** in 1.3.2 — Roll20 image responses are decoded before ZIP insertion and a
  rejected body falls through to the next host/resolution candidate.
- **Severity**: High — a complete Scene map can render blank while the export reports zero failures
- **Found**: 2026-08-23, attributing the malformed *Dead in Thay* Far Realm map
- **Component**: `src/R20Exporter.js` (`downloadR20Resource`, `_storeAsset`),
  `src/R20ExportManifests.js` (`R20ExportReport`)
- **Related**: B001, B003, Conv-B056

## Symptom

The *Dead in Thay* export contains the Far Realm Cysts map twice, once as the Scene graphic and
once as its thumbnail. Both files are non-empty JPEGs, both are listed as `bundled`, and the report
records one successful HTTP 200 attempt for each. Foundry renders the map white because the bytes
are truncated.

## Evidence

Immutable source archive:

- `TotYP_Dead in Thay_R20Export-1.0.1.zip`
- 659,653,839 bytes
- SHA-256 `C10DB5C01547D862A54BA4CEA0B89D0177D48BD61424ABC6B41B9265F16E90BC`

The same body occurs under both paths:

- `pages/006 - Far Realm Cysts/graphics/-KeJvyhWofghLWArFqEj.jpg`
- `pages/006 - Far Realm Cysts/thumbnail.jpg`

Each is 8,724,480 bytes with SHA-256
`660844837E142502E748ADA39A41D0DF1268D08BE92F97F976C6CB2D8CCE922F`. Both begin with JPEG SOI,
neither ends with EOI, and Pillow independently rejects both as `image file is truncated (3 bytes
not processed)`. Their `export_report.json` rows nevertheless say:

```json
{
  "outcome": "bundled",
  "bytes": 8724480,
  "content_type": "binary/octet-stream",
  "attempts": [{"status": 200, "error": null}]
}
```

## Cause

`downloadResource()` treated HTTP 200 as sufficient and passed the response blob to
`_storeAsset()`. `_storeAsset()` added the blob to the ZIP and called `report.succeeded()` before
hashing it. The hash proved only that bytes were retained, not that an image decoder could read
them. The candidate ladder therefore stopped at a malformed original instead of trying another
host, a lower resolution, or the existing canvas fallback.

## Fix

`downloadR20Resource()` now validates every candidate with the browser's `createImageBitmap()`
before `_storeAsset()` can add it to the ZIP. Validation is a tracked pending operation, so the ZIP
cannot finalize while decoding is in flight. A decode rejection:

- annotates the existing HTTP 200 attempt with `image decode failed: ...`;
- does not add the malformed body to the ZIP;
- advances through the existing host/resolution ladder and canvas fallback;
- ends as an ordinary reported asset failure when no candidate decodes.

Successful images must also have positive decoded dimensions. JPEG bodies are checked separately
for SOI and an EOI marker in the final 64 KiB because browser decoders may accept a partially
decodable truncated image. The extension's minimum Chrome 111 target supplies `createImageBitmap`;
an environment without that required decoder fails closed instead of silently skipping validation.

The two source paths are intentional, not a deduplication defect: Roll20 references the same bytes
as both a Scene graphic and a thumbnail, and the ZIP preserves both source locations for its
consumer. Each reference is independently validated before storage.

## Regression tests

`tests/assets.test.js` plants an HTTP 200 image body that the synthetic decoder rejects. One test
requires all three host spellings of the malformed original to be recorded as rejected before a
valid `max` candidate is stored as `bundled-lower-res`. A second makes every candidate malformed
and requires a failed report row with no ZIP member. A real JPEG-shaped byte fixture starts with SOI
but omits EOI and must be rejected even when the synthetic browser decoder accepts it. The complete
1.3.2 suite passes 63/63.