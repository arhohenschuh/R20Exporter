# B004: The 4 GB temporary-filesystem quota fails the export at the last step

- **Status**: **Fixed** in 0.14.0 — the staging file is written to OPFS, or
  streamed straight to a file the user picked. ADR-004. Tests:
  `tests/storage.test.js`.
- **Severity**: High — the export is lost after all the work is done
- **Reported**: [GH #23](https://github.com/kakaroto/R20Exporter/issues/23)
- **Component**: `src/R20Exporter.js` (`_saveZipToFile`)

## Symptom

The export downloads every asset, reaches "Generating ZIP file", and then dies:

```
Error creating zip file writer : QuotaExceededError
```

Everything already downloaded is discarded. The user has no artifact and no way
to resume — the only remedy offered was "clear your browser's cache folder".

## Cause

```js
requestFileSystem(window.TEMPORARY, 4 * 1024 * 1024 * 1024, …)
```

`window.webkitRequestFileSystem` is a deprecated, non-standard API whose
`TEMPORARY` pool is:

- **capped** — the 4 GB request is a request, not a grant; the browser hands out
  a fraction of free disk and silently gives less,
- **shared** across every origin using it, and
- **evictable** — the browser may reclaim it mid-write under disk pressure.

So the failure does not need a 4 GB campaign. It needs a busy disk.

The archive is also materialised twice: once as the staging file, then again as
a `Blob` handed to FileSaver, so peak usage is roughly double the archive size.

## Evidence

- Largest campaigns measured downstream: **2,965 MB** and **2,390 MB**. Neither
  is near 4 GB, and both have exported successfully — so the ceiling being hit
  in the field is the browser's *actual* grant, not the nominal 4 GB.
- The old zip.js has no Zip64, so even with unlimited storage an archive above
  4 GB could not be written at all.

## Fix

`_openZipDestination` degrades through three levels, each reported:

1. a file handle from `showSaveFilePicker()`, acquired during the click that
   starts the export (see ADR-004 for why not at the end) — the archive is
   streamed to it and never exists in memory or twice on disk;
2. an OPFS staging file — standard, origin-owned, not evictable behind the
   user's back, no 4 GB ceiling;
3. in-memory chunks, for a browser with neither.

The error message no longer tells the user to clear their cache. It says the
profile is out of disk space and that choosing a save location writes the zip
straight to disk.

## Regression test

`tests/storage.test.js` — "a failing destination is reported instead of hanging
the export" drives a destination whose `write()` rejects and asserts that the
export surfaces the error rather than stalling; the other three cases pin the
degradation order.
