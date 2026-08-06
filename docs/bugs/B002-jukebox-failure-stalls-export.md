# B002: A failed jukebox download never calls back and can stall the export

- **Status**: **Fixed** in 0.12.0.
- **Severity**: Medium (hangs the export; no error shown)
- **Component**: `src/R20Exporter.js` (`_addPlaylistToZip`)
- **Related**: GH #34 (exports stall at "Saving Characters").

## Symptom

An export stops advancing after the jukebox step. The dialog shows
"0 operations in progress" and never proceeds to the zip.

## Cause

The zip is written by a state machine that only advances when a step's callback
fires. Every other download passes `finallyCB` (`checkZipDone`) on both the
success and the failure path. The jukebox error handler did not:

```js
const errorCB = (url) => {
    return () => this.console.log("Couldn't download Jukebox audio from url : ", url)
}
this.downloadResource(url, this._makeAddBlobToZip(folder, name, finallyCB), errorCB(url))
```

If the last outstanding operation of the step was a track that failed, nothing
called `checkZipDone` again and the export waited forever.

## Fix

Both jukebox failure paths (direct URL and Battlebards) now record the failure
in the report and call `finallyCB()`.

## Note

Found by reading the code while wiring B001's accounting, not by a report — the
step never reached the point where a report would have been written. This is why
the accounting had to come first.
