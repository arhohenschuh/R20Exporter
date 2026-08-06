# ADR-004: Write the zip through OPFS and a save handle acquired up front

- **Status**: Accepted
- **Date**: 2026-08-06
- **Supersedes**: —
- **Superseded by**: —

## Context

The save path was the oldest code in the extension and the only part of it that
can lose an otherwise perfect export:

- `window.webkitRequestFileSystem(TEMPORARY, 4 GB)` — deprecated, non-standard,
  and its quota is a *shared, evictable* pool. It is the direct cause of the
  `QuotaExceededError` reports (GH #23, recorded as B004).
- zip.js from 2013 with `zip.useWebWorkers = false`, driving compression on the
  main thread one entry at a time through a hand-rolled `setTimeout` walk of the
  entry tree. A backgrounded tab is throttled to one timer callback per second,
  which is why the README told users to keep the tab focused "or it could take
  hours instead of minutes" (B005).
- FileSaver from 2014, which materialises the whole archive as one `Blob` before
  the download starts.

The largest campaigns measured downstream are 2,965 MB and 2,390 MB. None has
crossed 4 GB, so this is a latent defect rather than a blocker — but "complete
export" is meaningless for the users who cannot complete one.

The constraint that makes this delicate: the exporter's *only* job is not to
lose data, and R1 (ADR-001) exists precisely because losses used to be silent.
Replacing the save pipeline must be provably lossless.

## Decision

**Storage.** Use OPFS (`navigator.storage.getDirectory()`) for the staging file
instead of the deprecated temporary filesystem. OPFS is standard, origin-owned,
not evictable behind the user's back, and has no 4 GB ceiling.

**Zip.** Replace the 2013 zip.js with current `@zip.js/zip.js` (2.8.x, vendored
as `libs/zipjs/zip-fs.js`), configured with `useWebWorkers: true` and
`maxWorkers: navigator.hardwareConcurrency`. This brings Zip64, streamed writes,
and compression off the main thread — which also escapes background-tab
throttling, so an unattended export completes. The hand-rolled entry walk is
deleted: `zipFs.exportWritable()` does the same job, in order, with
`keepOrder: true` preserving the deterministic member order R1 depends on.

**Delivery.** Prefer `showSaveFilePicker()` and stream the archive straight to
the user's chosen file, so a multi-gigabyte archive never has to exist in memory
or twice on disk.

**The save handle is acquired during the click that starts the export**, not
when the zip is ready. `showSaveFilePicker()` requires a user gesture, and by
the time a 3 GB export finishes, hours may have passed and the gesture is long
gone — the picker would throw and the export would die at the last step, having
done all the work. A cancelled picker is not an error: it degrades to OPFS plus
a normal download.

**Three-level degradation**, each level reported: chosen file handle → OPFS
staging file → in-memory chunks. The last exists so a browser without OPFS still
produces an export rather than an error.

**The zip layout does not change.** Same folders, same member names, same pinned
1980 epoch mtimes. R20Converter's `getZipFile` path handling is the contract.

## Alternatives considered

- **Keep the 2013 zip.js and only swap the storage API.** Rejected: the
  main-thread compression is half the user-visible problem, and the old library
  has no Zip64, so a >4 GB archive is unrepresentable even with unlimited
  storage.
- **Bundle zip.js via npm at build time.** Rejected: the extension ships with no
  build step and no runtime dependencies (ADR-002). The library is vendored as a
  single file, exactly as before.
- **`showSaveFilePicker()` at the end, when the file is ready.** Rejected on the
  gesture requirement above. This is the failure mode that would only appear on
  the largest exports — the ones that can least afford to be repeated.
- **Drop the in-memory fallback.** Rejected: it is 6 lines and it is the
  difference between "no export" and "an export" on a browser without OPFS.

## Consequences

- Chrome/Edge remain the target. `showSaveFilePicker` is Chromium-only; OPFS is
  now cross-browser, so the Firefox blocker recorded in the README is no longer
  the storage API — it is only the picker, which degrades.
- The user sees a file dialog *before* the export starts. That is a visible
  behaviour change and is documented in the README.
- `zip.terminateWorkers()` must run when the export ends, including on failure,
  or the workers outlive the export.
- The staging file (`R20Exporter-tmp.zip`) is removed a minute after delivery,
  best effort — the browser may still be reading it when the download starts.
