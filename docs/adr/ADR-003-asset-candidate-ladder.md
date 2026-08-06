# ADR-003: One candidate ladder owns host and resolution selection

- **Status**: Accepted
- **Date**: 2026-08-06
- **Applies to**: 0.13.0 (R2) onward

## Context

Roll20 moved its asset CDN. Objects that used to be served from
`s3.amazonaws.com/files.d20.io/…` now answer on `files.d20.io/…`, and the old
spelling 403s (Conv-B048). Separately, each image exists under
`original`/`max`/`med`/`thumb` names, but not at every resolution.

0.11.0 had *both* mechanisms and still lost assets:

- the host rewrite was **duplicated** in `downloadResource` and
  `downloadR20Resource`, **one-way**, and covered **one** spelling;
- the resolution ladder lived only in `downloadR20Resource`;
- `DO_NOT_RETRY` on 403/404 ended the *resolution* walk but never tried another
  *host*.

The rewrite inside `downloadResource` actively defeated any host fallback added
above it: an `s3.amazonaws.com` candidate was silently rewritten back to the
direct host before the request was made (B003).

## Decision

A single pure function, `assetCandidates(url)`, produces the ordered list of
`{url, variant}` spellings, and it is the **only** place that decides which URL
to try:

1. Resolutions are walked `original → max → med → thumb`.
2. **Every host is tried at a resolution before dropping to a smaller one**, so
   a host rename never costs image quality.
3. Host order is `files.d20.io` → `s3.amazonaws.com/files.d20.io` →
   `files.staging.d20.io`, **pinned to R20Converter's `Entity.hostCandidates`**.
   If the two components disagree about which host answers first, an asset looks
   dead in one tool and alive in the other — precisely the confusion Conv-B048
   caused.
4. Both spellings of one object normalise to the same ladder, so an old URL and
   a new URL are never treated as two different assets.
5. `downloadResource` performs **no** host rewriting.

An asset is only called dead after every host × resolution candidate *and* the
canvas fallback have failed. Each attempt is recorded in the report with its
HTTP status.

**The stored filename keeps the extension from the source URL, even when the
canvas fallback re-encoded the image to PNG.** This contradicts the roadmap's
original R2 wording ("store under the true type") and the change was made with
evidence: `R20Converter.copyZipFile` derives the expected zip member name from
the asset URL's extension, so a `.png` member for a `.webp` URL is not found,
and the converter then falls back to downloading a URL that is dead — which is
exactly why the canvas path ran. Storing under the true type would turn a
recovered asset into a lost one. The real type is recorded in the report as
`content_type` with `outcome: "canvas-reencoded"` instead (GH #11), so the
mismatch is documented rather than silent.

## Consequences

- A dead asset now costs up to 12 requests plus 12 canvas attempts before it is
  reported dead. Measured on *The Sunless Citadel*: 499 assets, 498 bundled,
  1 genuinely dead after 33 attempts, 158 s total.
- Every stored asset carries `sha256`, `bytes`, `served_from` and `variant`, so
  future CDN rot is detectable against a recorded baseline instead of inferred
  by re-probing.
- Hashing holds a pending operation open, which guarantees the manifests are
  written only after every hash is in.

## Alternatives considered

- **Keep the rewrite and add hosts around it.** Rejected: the rewrite is what
  breaks the fallback, and two components deciding the host is how the original
  bug survived two releases.
- **Probe hosts once and cache the winner.** Deferred: the failing asset is
  usually a *specific* object, not a whole host, so a per-host verdict would
  skip candidates that would have worked.
