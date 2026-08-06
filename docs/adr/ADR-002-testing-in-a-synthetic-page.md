# ADR-002: Test the shipped code in a synthetic Roll20 page

- **Status**: Accepted
- **Date**: 2026-08-06
- **Applies to**: 0.12.0 (R1) onward

## Context

The extension had ~1,700 lines of JavaScript and **zero** tests. It only runs
inside Roll20's editor, reading page internals (`Campaign`, `BackboneFirebase`,
`window.is_gm`) that are an unversioned private API. The obvious ways to make it
testable were both bad: refactor the exporter into importable modules (a large,
risky change to a tool whose only job is not to lose data), or test nothing and
rely on manual exports of other people's copyrighted campaigns.

The roadmap also demands that *a step is not done until its gate is measured*.
Gates that can only be measured by a human doing a two-hour export against a
live campaign are, in practice, never measured.

## Decision

**Reproduce the page contract instead of refactoring the exporter.**

`tests/harness/roll20.js` builds a synthetic Roll20 page — Backbone-shaped
collections, `BackboneFirebase`, a routed `fetch`, a minimal jQuery, an
in-memory `zip.fs`, `crypto.subtle` — and runs the **real, shipped**
`src/*.js` files inside it with `node:vm`. Tests drive `exportCampaignZip()`
end to end and assert on the resulting zip and sidecars.

- No build step, no bundler, no runtime dependencies. `npm test` is
  `node --test "tests/**/*.test.js"`.
- New pure logic lives in `src/R20ExportManifests.js`, written to work both as
  a classic page script and as a CommonJS module, so builders can also be unit
  tested directly.
- The fixture campaign carries **planted defects** (a token whose character was
  deleted, an asset dead on every host, an asset alive only on the legacy host,
  a page that exported empty with a thumbnail, an unusable roll payload). A
  gate that cannot fail is not a gate.
- The harness has no image decoder, so the canvas fallback always fails there —
  which is the path a test wants to exercise anyway.

**Live verification is done with Playwright** against a real campaign, by
serving the same `src/` files through a routed URL and letting the page load
them as ordinary scripts. Roll20's editor now sends a strict CSP
(`script-src 'self' 'unsafe-eval' 'nonce-…' https://cdn.roll20.net blob:`),
so inline injection is blocked; routing a `cdn.roll20.net` URL to the local
files reproduces the extension's own injection faithfully.

## Consequences

- The tests exercise the code that actually ships, including its callback state
  machine, not a parallel re-implementation.
- The harness must track the page contract. When Roll20 changes, the harness
  changes — which is the same maintenance the extension already carries, now
  written down in one place.
- Objects created inside the vm belong to another realm; `assert.deepEqual`
  compares prototypes, so cross-realm comparisons go through a JSON round trip.

## Alternatives considered

- **Refactor to ES modules + bundler.** Rejected for now: zero user value, and
  it would rewrite the save path before any safety net existed.
- **Playwright-only testing.** Rejected as the primary gate: it needs a live
  login, a real campaign and minutes per run. It remains the *acceptance* gate.
- **Golden-file tests over a real export.** Rejected: exports are third-party
  copyrighted material and gigabytes in size.
