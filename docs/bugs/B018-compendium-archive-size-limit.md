# B018: Large compendium books fail at the 512 MiB stored-content cap

- **Status**: Fixed in 1.5.6 (2026-11-11)
- **Severity**: High - an entire large book cannot be exported; the capture is discarded
- **Found**: 2026-11-11, owner export of *Mordenkainen Presents - Monsters of the Multiverse* with 1.5.5
- **Component**: `src/R20Compendium.js` (`R20CompendiumCollector.write`), `src/R20CompendiumPage.js` (`store`)
- **Related**: [ADR-006](../adr/ADR-006-optional-compendium-export.md), [ADR-008](../adr/ADR-008-stage-members-on-arrival.md), [B012](B012-retained-blobs-unreadable-at-finalization.md)

## Symptom

The toolbar reported `Export failed: archive-size-limit` after discovering 329 pages. No ZIP
was delivered. The downloaded report showed:

| Field | Value |
| --- | ---: |
| Pages planned / captured | 329 / 328 (1 `empty-compendium-entry`) |
| Images planned / bundled / failed | 553 / 291 / 262 |
| `stored_bytes` at failure | 534,841,111 |
| `issues` | `archive-size-limit` |

All 262 failed images carry reason `archive-size-limit`. The book is an illustrated bestiary
with one large portrait per creature. At the measured average of about 1.8 MB per image, the
complete capture needs roughly 1 GB.

## Cause

ADR-006 bounded stored content at 512 MiB (`maxArchiveBytes`). That bound was not a format
limit. zip.js writes Zip64, and campaign archives above 2 GB are routinely delivered. It
protected memory: every compendium member was held as an in-memory `Blob` in `zip.fs` until
the ZIP was written. A larger cap without staging would recreate the B012 lifetime risk that
ADR-008 removed for campaign exports and left as an explicit compendium follow-up.

The cap is fatal by design (`write` throws with `fatal: true`), so the remaining 262 images
failed and the whole capture was refused rather than delivered partial.

## Resolution In 1.5.6

The compendium export now stages members exactly as campaign exports do (ADR-008):

1. After the save picker, the toolbar opens an OPFS staging store. Each member the collector
   stores is read once, persisted, and added through `R20Archive.addMember`; the ZIP entry
   reopens the persisted file only while the archive is written. The staging directory is
   removed when the export ends, delivered or not.
2. With staging, the stored-content cap is **4 GiB**. Without OPFS, or if opening the store
   fails, members remain Blobs and the 512 MiB cap still applies.
3. A member whose staging write fails is a fatal `archive-write-failed`, as before; nothing
   partial is delivered from a half-staged archive.
4. `export_report.json` gains additive fields: `member_storage` (`opfs-staging` or `memory`),
   `archive_limit_bytes`, and `staging_unavailable` when staging could not be opened. The
   archive format (`R20Compendium_format` 1.0) is unchanged.

## Validation, 2026-11-11

| Check | Result |
| --- | --- |
| `B018` toolbar regressions against published 1.5.5 | 3 of 3 fail: no staging, fixed 512 MiB cap, no storage fields |
| Same regressions on 1.5.6, plus the fail-closed cap guard | 4 / 4 pass |
| Full suite, source and extracted package | 149 / 149 |
| Installed 1.5.6 extension in Edge 157.0.4341.42 | Compendium smoke passes; both captures report `member_storage: opfs-staging`, cap 4,294,967,296 B |
| Real Edge, shipped `R20Archive.js` and zip.js workers | 4,000 members, 644.6 MB, staged in 5.4 s and zipped in 15.6 s; 4,000 / 4,000 SHA-256 match |

`tests/compendium.test.js` now honors `R20EXPORTER_TEST_ROOT`, so a packaged or previous
build can be tested; it previously always loaded the repository source. The smoke tool's
button-containment check gained a 0.5 px tolerance. On Edge 157, the *Download report* edge
landed 0.00005 px past its toolbar, which failed 1.5.5 identically; no layout changed.

The owner's re-export of *Monsters of the Multiverse* is the remaining live check.
