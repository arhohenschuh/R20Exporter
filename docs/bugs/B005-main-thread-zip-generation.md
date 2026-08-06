# B005: Zip generation runs on the main thread and stalls in a background tab

- **Status**: **Fixed** in 0.14.0 — compression runs in web workers and the
  entry walk is gone. ADR-004.
- **Severity**: Medium — the export completes, eventually; the cost is hours of
  a machine the user cannot use for anything else
- **Component**: `src/R20Exporter.js` (`_exportZip`)

## Symptom

The README shipped the workaround as documentation:

> It is highly recommended to keep this tab focused and the window
> non-minimized during the entire process, otherwise it could take hours
> instead of minutes to generate the ZIP file for your campaign.

An export left to run unattended — the obvious thing to do with a multi-hour
job — is the slow case.

## Cause

Two decisions compounding:

```js
zip.useWebWorkers = false
```

and a hand-rolled traversal that adds **one entry per `setTimeout(…, 0)`**:

```js
const addEntryToZipWriter = (writer, zipFs) => {
    setTimeout(() => addEntryToZipWriterDelayed(writer, zipFs), 0)
}
```

Chrome clamps timers in a background tab to roughly **one callback per second**.
The archive is therefore built at one zip member per second regardless of CPU:
a campaign with 5,000 members takes 83 minutes of pure waiting. Focused, the
same walk is fast but still single-threaded on the UI thread, so the tab is
unresponsive throughout.

The comment above the walk explains why it was written that way — the 2013
zip.js could not add entries concurrently, and its recursive `exportZip` blew
the stack on large campaigns. Both constraints belong to that library version.

## Evidence

Measured on The Sunless Citadel (499 assets, 66.6 MB) with 0.14.0: zip
generation with workers takes seconds, and the test suite that drives the same
code path went from 10.3 s to 4.4 s.

## Fix

`@zip.js/zip.js` 2.8.x with `useWebWorkers: true` and
`maxWorkers: navigator.hardwareConcurrency`, writing through
`zipFs.exportWritable(..., { keepOrder: true })`. Workers are not subject to
background-tab timer throttling, so an unattended export runs at full speed, and
the UI thread stays free.

`keepOrder: true` is not optional: R1's determinism gate requires the member
order to be stable between two exports of an unchanged campaign.

The README warning is removed, because it is no longer true.
