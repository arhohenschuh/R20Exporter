# Defect records

One file per defect, numbered `B<nnn>`. A record is written when the defect is
understood, not when it is fixed, and it keeps the evidence: the symptom, the
cause in the code, and the measurement that proved it.

**Every bug gets a regression test before its fix is accepted** — or, where the
behaviour only exists inside Roll20's page, a recorded fixture in
`tests/fixtures/`. Records from the downstream converter are cited as
`Conv-B0nn` to keep the two trackers distinct.

| Bug | Title | Status |
| --- | ----- | ------ |
| [B001](B001-silent-asset-failures.md) | Asset download failures are silent | Fixed 0.12.0 / 0.13.0 |
| [B002](B002-jukebox-failure-stalls-export.md) | A failed jukebox download never calls back and can stall the export | Fixed 0.12.0 |
| [B003](B003-host-rewrite-defeats-fallback.md) | The host rewrite in `downloadResource` defeats the fallback ladder | Fixed 0.13.0 |
| [B004](B004-temporary-filesystem-quota.md) | The 4 GB temporary-filesystem quota fails the export at the last step | Fixed 0.14.0 |
| [B005](B005-main-thread-zip-generation.md) | Zip generation runs on the main thread and stalls in a background tab | Fixed 0.14.0 |
| [B006](B006-empty-export-before-campaign-loads.md) | An export started before the campaign loads silently produces an empty archive | Fixed 0.15.0 |
| [B007](B007-cors-candidate-retried.md) | A CORS-blocked candidate is retried with backoff, multiplying dead time | Fixed 1.0.0 |
| [B008](B008-campaign-sheet-template-misrepresents-mixed-campaigns.md) | One campaign-level sheet template misrepresents mixed-sheet characters | Fixed 1.3.1 |
| [B009](B009-malformed-http-200-images-reported-bundled.md) | Malformed HTTP 200 images are reported as successfully bundled | Fixed 1.3.2 |
| [B010](B010-map-pins-omitted.md) | Jumpgate Map Pins are omitted while collection parity reports complete | Fixed 1.4.0 |
