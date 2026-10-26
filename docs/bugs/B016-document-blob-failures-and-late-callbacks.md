# B016: Document blob failures erase content and late callbacks complete twice

- **Status**: Fixed in 1.5.4 (2026-10-26)
- **Severity**: High - source text can be lost without a structured failure
- **Found**: 2026-10-25, deterministic fault injection in the existing Roll20 harness
- **Component**: `src/R20Exporter.js`, `getLatestBlob` and `updateModel`
- **Observed code**: v1.5.3, commit `e987a417d05eced9e3c7e22dcd82461ccb0411b6`
- **Related**: [B001](B001-silent-asset-failures.md), [B012](B012-retained-blobs-unreadable-at-finalization.md)

## Confirmed Behavior

When `_getLatestBlob` never invokes its callback, or throws synchronously, the timeout path
assigns `""` to the missing field, removes its pending operation and resumes export. It logs
`Timeout waiting for blob from Roll20`, but adds no document/field failure to the structured
report. `report.failures.length` remains zero and `report.toJSON().notes` remains empty.
The result is indistinguishable there from a successful read of genuinely empty source text.

A callback delivered after that timeout still enters `updateModel`. It replaces the already
settled field and invokes the continuation a second time when no other operations are pending.
That permits post-completion mutation and duplicate state-machine advancement.

Character biography, GM notes and default-token reads use this helper. Other call sites share
the same lifecycle risk. This finding concerns Roll20 document-field reads, not the retained
downloaded asset `Blob` lifetime hypothesis in B012.

## Evidence And Limits

Ten helper-level cases were executed against the real exporter class through
[tests/harness/roll20.js](../../tests/harness/roll20.js): five read outcomes under each of two
unrelated synthetic document identities. The exporter source file was unchanged from the
commit above. Existing local manifest, report-version and documentation edits were not modified
or treated as the cause.

| Outcome | Value after timeout check | Final value | Continuation calls | Reported failures |
| --- | --- | --- | ---: | ---: |
| Successful callback | `source text` | `source text` | 1 | 0 |
| Successful empty callback | empty | empty | 1 | 0 |
| Callback never arrives | empty | empty | 1 | 0 |
| Synchronous read exception | empty | empty | 1 | 0 |
| Callback arrives after timeout | empty | `late source text` | 2 | 0 |

Every case ended with zero pending operations and an empty structured notes array. The two
identities produced identical results. The scheduled 10,000 ms timeout callback was invoked
directly, avoiding wall-clock delays without changing exporter code.

This confirms the helper defect and reporting gap. It does **not** establish that a specific
published campaign lost text, measure a fleet-wide affected population, or prove a complete
ZIP race from the late callback. Those broader claims require separate evidence.

## Historical Reproducer

The following JavaScript was executed with Node from the repository root before the fix. It
asserts the preceding buggy behavior and unaffected success/empty controls, so it is expected
to fail on the fixed working copy. Current regressions assert the corrected behavior instead.

```javascript
const assert = require("node:assert/strict");
const { createExporter } = require("./tests/harness/roll20.js");
const results = [];
for (const identity of ["Document A", "Unrelated Document B"]) {
    for (const mode of ["success", "empty", "never", "throws", "late"]) {
        const page = createExporter({ title: identity });
        const timers = [];
        page.sandbox.setTimeout = (callback, ms) => timers.push({ callback, ms });
        const data = {};
        let completions = 0;
        let deliver;
        const model = { id: identity, _getLatestBlob(field, callback) {
            deliver = callback;
            if (mode === "throws") throw new Error("synthetic read failure");
            if (mode === "success") callback(escape("source text"));
            if (mode === "empty") callback("");
        } };
        const operation = page.exporter.newPendingOperation("read " + identity);
        page.exporter.getLatestBlob(model, "gmnotes", data, operation, () => completions++);
        assert.equal(timers.length, 1);
        assert.equal(timers[0].ms, 10000);
        timers[0].callback();
        const timeoutValue = data.gmnotes;
        if (mode === "late") deliver(escape("late source text"));
        assert.equal(timeoutValue, mode === "success" ? "source text" : "");
        assert.equal(data.gmnotes, mode === "late" ? "late source text" : timeoutValue);
        assert.equal(completions, mode === "late" ? 2 : 1);
        assert.equal(page.exporter.numPendingOperations, 0);
        assert.equal(page.exporter.report.failures.length, 0);
        assert.deepEqual(Array.from(page.exporter.report.toJSON().notes), []);
        results.push({ identity, mode, timeoutValue, finalValue: data.gmnotes, completions });
        page.stop();
    }
}
console.log(JSON.stringify({ confirmed: true, cases: results.length, results }, null, 2));
```

## Suggested Generic Fix

1. Give each document-field read one settlement state. Ignore late or duplicate callbacks
   **before** mutating the exported data or touching operation counters.
2. Settle success, synchronous exceptions and timeout exactly once; clear the timer when a
   read settles. Keep successful empty content distinct from failed acquisition.
3. Record failed document reads with document identity, field, reason and outcome. Either abort
   the export or clearly mark an explicitly retained partial export as incomplete. Do not let
   a log-only timeout become an apparently clean result with an empty replacement value.
4. Include document-read failures in the completion summary, not only downloaded asset failures.

## Required Regressions

- Successful text, successful empty text and valid default-token JSON remain unchanged.
- A never-callback read and a synchronous exception produce explicit structured failure evidence.
- Late and duplicate callbacks cannot mutate settled data or run completion twice, both with
  and without unrelated operations still pending.
- Cover character and handout callers with different IDs/names; intentionally unread fields
  outside the user's permissions must not be reported as acquisition failures.
- Exercise full JSON/ZIP export: no clean-success result after required document content fails,
  and no late-callback mismatch between saved content and integrity metadata.

## Resolution In 1.5.4

`getLatestBlob` now settles each read once, clears its timer and ignores later callbacks before
mutating data or completing an operation. Exceptions are recorded immediately; timeouts retain
the existing no-progress timing policy. Failed reads do not manufacture empty source values.

`R20ExportReport.documentReadFailures` records document ID/name, field, reason and error message,
and serializes as `document_read_failures`. Both campaign save paths refuse output after a
required read fails, display the failure details in the Export Log and leave the dialog open.
No partial campaign artifact is delivered. Diagnostic text is HTML-escaped before logging.

A new parse clears the preceding attempt's document-read failures, allowing a successful retry.
Successful text, genuinely empty fields, valid default-token JSON and permission-hidden fields
retain their existing behavior. This does not change compendium export's separate partial-output
policy or repair the provisional downloaded-Blob issue B012.

Validation on 2026-10-26: all **22 B016 tests** in
[tests/characters.test.js](../../tests/characters.test.js) pass, including complete JSON/ZIP
attempts for character and handout timeout/exception failures, late/duplicate callbacks,
unrelated pending work, success/permission controls and retry. The first six lifecycle tests
failed before implementation. The full exporter suite passes **137 tests**.

Release validation repeats all 22 B016 checks against the exact extracted extension ZIP using
the test-only `R20EXPORTER_TEST_ROOT` override. The six original lifecycle regressions still
fail against the published 1.5.3 archive. All 20 shipping files match source, build and extraction.

The installed-extension compendium smoke test passes in Edge 156.0.4314.42: ordinary capture,
navigation through empty entries, cancellation, world isolation and desktop/mobile rendering.
B016 campaign behavior is verified with the mock Roll20 page harness; no live campaign
re-export or full real-campaign acceptance is claimed. Release evidence is retained under
`D:/Automation_Local/Work/Tooling/r20exporter/v154-b016/Reports/`.