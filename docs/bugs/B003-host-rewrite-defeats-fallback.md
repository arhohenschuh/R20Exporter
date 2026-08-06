# B003: The host rewrite in `downloadResource` defeats the fallback ladder

- **Status**: **Fixed** in 0.13.0.
- **Severity**: High (silently loses every asset that only answers on the legacy host)
- **Component**: `src/R20Exporter.js` (`downloadResource`)
- **Related**: ADR-003, Conv-B048. Test: `tests/assets.test.js` — *"an asset that only answers on the legacy host is recovered, not lost"*.

## Symptom

With the host fallback ladder in place, an asset reachable **only** at
`https://s3.amazonaws.com/files.d20.io/…` was still reported `failed`. The
request log showed the legacy candidate had been requested against
`files.d20.io` instead.

## Cause

`downloadResource` rewrote the URL before fetching, one line into the function:

```js
url = url.replace("https://s3.amazonaws.com/files.d20.io/", "https://files.d20.io/")
```

The same rewrite also existed in `downloadR20Resource`. Two layers deciding the
host meant the lower layer silently undid the upper layer's decision: every
legacy-host candidate the ladder produced was converted back to the direct host
and re-tried against a URL that had already failed.

## Fix

`downloadResource` performs no host rewriting; `assetCandidates()` is the only
place that chooses a host (ADR-003). The rewrite in `downloadR20Resource` is
gone too — the ladder subsumes it and covers both spellings in both directions.

## Note

This was caught by the test written for the fix it was blocking, on a fixture
asset that only answers under the legacy spelling. Without that fixture the
ladder would have shipped looking correct and recovering nothing — which is
what 0.11.0 did for two releases.
