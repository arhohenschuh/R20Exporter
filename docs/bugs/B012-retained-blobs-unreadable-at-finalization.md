# B012: Retained asset Blobs can become unreadable before ZIP finalization

- **Status**: **Provisional** - observed once on an interrupted run; clean Icewind and DotMM controls did not reproduce it
- **Severity**: High - all downloaded data can be lost at the final ZIP step
- **Found**: 2026-08-27, live Playwright export of *Waterdeep - Dungeon of the Mad Mage*
- **Component**: `src/R20Exporter.js` (`downloadResource`, `_storeAsset`, `_addFileToZip`, `_exportZip`)
- **Related**: B004, B005, B010, B011

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
