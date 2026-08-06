# B007: A CORS-blocked candidate is retried with backoff, multiplying dead time

- **Status**: **Fixed** in 1.0.0 — a candidate that fails is abandoned when the
  ladder still has somewhere else to go; backoff is kept only for the last one.
  Tests: `tests/assets.test.js`.
- **Severity**: Medium — no data is lost, but a large campaign spends minutes per
  dead asset and looks hung
- **Found**: 2026-08-06, exporting *Curse of Strahd* with 0.15.0
- **Component**: `src/R20Exporter.js` (`downloadResource`, `downloadR20Resource`)
- **Related**: B003 — this is the cost of the fallback the ladder restored.

## Symptom

The export sits at "1 operations in progress" for the better part of a minute,
repeating the same request:

```
07:49:11  Access to fetch at 'https://s3.amazonaws.com/files.d20.io/marketplace/321287/…/original.png'
          from origin 'https://app.roll20.net' has been blocked by CORS policy
07:49:22  … the same URL again
07:49:43  … and again
07:49:44  … then max.png, which will do the same
```

## Cause

Two correct decisions that combine badly.

`downloadResource` retries with exponential backoff unless the failure is a 403
or 404:

```js
if (expBackoff < 30 && error.message != "DO_NOT_RETRY") { …retry… }
```

A CORS rejection never produces an HTTP status at all — `fetch` rejects with a
`TypeError`, so it is indistinguishable from a transient network error and is
retried three times over roughly 45 seconds.

Meanwhile ADR-003 made the ladder try **twelve** candidates per asset (four
resolutions × three host spellings). The legacy `s3.amazonaws.com/files.d20.io/…`
spelling is exactly the one the browser can never fetch: it serves no
`Access-Control-Allow-Origin` header, which is *why* Roll20 rewrites those URLs
in its own client, and why the code B003 deleted existed in the first place.

So a dead marketplace asset costs up to `12 candidates × 45 s` ≈ **9 minutes**,
all of it spent re-asking a question whose answer cannot change.

The deeper point: **the ladder made per-candidate backoff redundant.** Retrying
one URL and trying a different URL are two answers to the same question, and
after ADR-003 the second one is strictly better — it is both faster and more
likely to succeed.

## Evidence

- *The Sunless Citadel* did not show this: its one dead asset answered **404**,
  which short-circuits via `DO_NOT_RETRY`. 33 attempts completed inside a 158 s
  run. The bug needs a failure with no HTTP response.
- *Curse of Strahd* carries marketplace art whose legacy spelling is CORS-blocked,
  and the same URL is visibly requested three times ~11 s and ~21 s apart before
  the ladder advances one rung.

## Fix

`downloadR20Resource` passes a no-retry backoff to every candidate **except the
last**. While the ladder still has somewhere else to go, a failure advances it
immediately; only the final candidate — the point at which giving up really does
mean losing the asset — is retried with backoff.

The legacy spelling is **kept** as a candidate even though the browser cannot
usually fetch it. It costs one request now, and its presence in `attempts[]` is
what tells a downstream tool (which has no CORS restriction) that the object may
still be there. Removing it would hide information; retrying it wasted time.

## Regression test

`tests/assets.test.js` — "a candidate that cannot be fetched is abandoned, not
retried" counts the requests made for an asset whose non-final candidates reject
without a status, and asserts one request per candidate.
