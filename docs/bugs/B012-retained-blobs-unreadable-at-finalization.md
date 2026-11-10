# B012: Retained asset Blobs can become unreadable before ZIP finalization

- **Status**: **Fixed in 1.5.5** (2026-11-10). Chromium's invalidation mechanism remains unconfirmed; the exporter no longer depends on it
- **Severity**: High - all downloaded data can be lost at the final ZIP step
- **Found**: 2026-08-27, live Playwright export of *Waterdeep - Dungeon of the Mad Mage*
- **Component**: `src/R20Exporter.js` (`downloadResource`, `_storeAsset`, `_addFileToZip`, `_exportZip`)
- **Related**: B004, B005, B010, B011, [B017](B017-zero-pending-stall-at-step-boundary.md)

## Symptom

R20Exporter 1.4.1 completed campaign parsing and asset acquisition, reached ZIP
generation, and then zip.js failed while reading a previously downloaded entry:

```text
NotReadableError
```

No usable browser archive was produced. This was not a malformed Map Pin or Pin
serialization failure: the campaign and all 1,620 Pins had completed parsing
before finalization began.

## Current hypothesis

Downloaded response bodies are retained as `Blob` objects in `zip.fs`:

```js
response.blob()
zipFs.addBlob(filename, content)
```

The exporter hashes each Blob when it arrives, but it does not persist its bytes.
`exportWritable()` reads the same Blob again only after every campaign collection
and asset has finished. On a sufficiently long or interrupted export, Chromium
can invalidate the temporary backing files for those response Blobs. Final ZIP
generation then has no readable source bytes even though acquisition previously
succeeded.

This is a lifecycle hypothesis, not yet a confirmed root cause. The ZIP writer,
destination opener, finalizer, and Blob insertion methods are byte-identical in
1.3.2 and 1.4.1. The Pin work increased this run's duration but did not change
the failing writer path.

## Evidence

A post-failure live probe measured:

| Measurement | Result |
| --- | ---: |
| Retained Blob entries | 9,079 |
| Unreadable | 8,812 |
| Readable | 267 |
| First unreadable member | `characters/052 - Boar/avatar.png` |
| Browser storage quota | 11,830,098,478 bytes |
| Browser storage usage | 3,129 bytes |
| OPFS temporary ZIP present | No |

The export had stalled at several zero-pending state-machine boundaries and was
resumed in the page. Failure occurred before a download event or meaningful OPFS
write, so destination disk space and OPFS quota do not explain this observation.

Recovery did not treat the failed browser state as valid output. It combined
fresh live campaign JSON with 6,475 asset bodies from the preceding export only
after verifying all 6,475 SHA-256 values, then passed ZIP CRC, 29/29 page closure,
and 1,620/1,620 Pin closure.

## Reproduction results

Two clean runs used the exact built 1.4.1 browser runtime and the unchanged ZIP/
Blob path:

| Campaign | Pins | Retained Blobs | Readable | Unreadable | Finalizer |
| --- | ---: | ---: | ---: | ---: | --- |
| *Icewind Dale: Rime of the Frostmaiden* | 0 | 7,309 | 7,309 | 0 | ZIP written |
| *Waterdeep: Dungeon of the Mad Mage* | 1,620 | 9,712 | 9,712 | 0 | ZIP written |

The 2,767,467,856-byte Icewind archive passes CRC, 42/42 page JSON closure,
collection parity, and 4,742/4,742 successful asset hashes. The
2,068,893,371-byte clean DotMM archive passes CRC, 29/29 page JSON closure,
1,620/1,620 Pin closure, collection parity, and 6,476/6,476 successful asset
hashes.

These controls disprove a simple campaign-size or Map-Pin cause. They leave the
failed run's interruption history and elapsed Blob lifetime as the leading
hypothesis. A future reproducer should still record:

1. Campaign ID, engine, page count, asset count, and expected archive size.
2. Acquisition start time, finalization start time, and any zero-pending stalls.
3. Retained Blob count and readability immediately before `exportWritable()`.
4. Finalizer result and first unreadable member, if any.
5. ZIP CRC, manifests, and collection parity if the export succeeds.

A second `NotReadableError` now needs an intentionally prolonged or interrupted
run to discriminate elapsed lifetime from state-machine interruption. A clean
large export is no longer a useful reproducer by itself.

## Candidate repair direction

Persist asset bytes as they are acquired and make ZIP entries read from that
durable staging store, rather than keeping thousands of response Blob handles
until the end. Any repair needs a regression test whose Blob is readable during
acquisition and deliberately unreadable at finalization; the export must still
complete from persisted bytes.

## Triage, 2026-11-10

**The measured unreadable set was store-wide.** Only 267 of 9,079 retained
entries were readable, and the first unreadable member was the 53rd character's
avatar. Every character, handout and page also contributes exporter-built JSON
and HTML Blobs. With far more than 267 such members, constructed Blobs must also
have become unreadable, not only `fetch` response bodies. Any repair that
protects downloads alone would therefore be incomplete.

**The interruptions were a separate exporter defect.** The failed run "stalled at
several zero-pending state-machine boundaries". The save state machine advanced only
when a `finallyCB` happened to run after the last pending operation. One deterministic
path violates that: the last canvas candidate produces a Blob that fails validation,
such as the 0 × 0 graphic class seen in Conv-B049. `finallyCB()` then runs while
validation is still pending, and validation completes with no continuation. The export
waits forever with nothing pending. This is recorded as
[B017](B017-zero-pending-stall-at-step-boundary.md). It explains why the run needed
manual resumes, and therefore why its Blobs lived far longer than in the clean
controls.

**Which Chromium mechanism invalidated the Blobs is not established.** Candidates
include loss of paged blob backing files and blob-storage limits during a long,
interrupted session. No evidence discriminates them, and reproducing a browser-
internal failure would require hours of controlled live exports. The repair does
not depend on the answer. No ZIP member is read from a Blob retained since
acquisition.

**Deterministic reproducer.** `tests/staging.test.js` runs the shipped exporter
with a Blob class that reads normally during acquisition and rejects with
`NotReadableError` once finalization begins. That covers response bodies and
exporter-built JSON/HTML. Against unchanged 1.5.4 source, the export fails with
the incident's message:

```text
Error writing the zip file:  The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.
```

## Resolution In 1.5.5

Every ZIP member is now **staged on arrival** ([ADR-008](../adr/ADR-008-stage-members-on-arrival.md)):

1. `_addFileToZip` adds the zip entry immediately, so member order is unchanged.
   It then reads the Blob once, computes the asset's SHA-256 from that read and
   writes the same bytes to a per-export OPFS directory
   (`R20Exporter-staging-<epoch-ms>-<random>`).
2. Once written, the Blob reference is dropped. The zip entry holds an OPFS file
   handle. A `zip.Reader` subclass opens the file only when zip.js writes that
   entry, checks the expected size and reads it in chunks.
3. A member that cannot be read at finalization fails the export and names that
   member, for example `could not read campaign.json (NotFoundError: …)`. The partial
   destination is aborted and nothing is delivered.
4. The staging directory is removed when the export ends, successfully or not.
   Directories left by exports older than 48 hours are removed when the next export
   starts. A recent directory may belong to another tab's active export and is kept.
5. If OPFS is unavailable, or a member's staging write fails, that member keeps its
   Blob, which matches 1.5.4 behavior. `export_report.json` then carries one `B012:`
   note with the count and first reason, and the dialog shows a warning.

At most 16 members are read and written at once. One staging operation may take
120 s before its member keeps its Blob. Each staging operation holds the save state
machine open, as hashing already did, so manifests are still written after every
hash.

## Validation, 2026-11-10

| Check | Result |
| --- | --- |
| Acquired Blobs unreadable at finalization, 1.5.4 source | **fails**: `NotReadableError`, no ZIP |
| Same test, 1.5.5 | ZIP delivered; every bundled asset's ZIP bytes match its SHA-256 recorded on arrival; the acquired Blobs reject on a control read |
| Staged file removed before finalization | export fails naming `campaign.json`; nothing delivered; partial OPFS ZIP removed |
| OPFS unavailable / staging writes fail (`QuotaExceededError`) | ZIP delivered from Blobs; one `B012:` report note with count and reason |
| Abandoned (> 48 h) and live staging directories | abandoned removed, live kept, own removed |
| ZIP start throws (e.g. `RangeError` serializing a huge campaign) | failure shown, nothing left pending, a retry in the same tab completes |
| Full suite with OPFS staging on by default in the harness | 145 / 145 |
| Real Edge 157.0.4341.42, shipped `R20Archive.js` + zip.js workers | 1,500 members / 241.7 MB staged in 2.4 s; ZIP in 7.3 s; 1,500 / 1,500 SHA-256 match; cleanup and lost-file naming pass |

No live Roll20 campaign re-export is claimed for this release. The harness exercises
the campaign path; the Edge check exercises the browser storage and zip.js contract.

An independent code review of the candidate found one medium defect, which has been fixed.
If writing the ZIP failed to start, its operation stayed open, so every later export in the
same tab hung while parsing. The failure-path regression above failed before the fix and
passes after it.
