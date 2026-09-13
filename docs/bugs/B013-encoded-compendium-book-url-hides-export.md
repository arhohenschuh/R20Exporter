# B013: Encoded Book URLs Hide the Compendium Export Toolbar

- Status: Fixed in 1.5.1 candidate
- Found: 2026-09-13, owner inspection of Storm King's Thunder
- Component: src/R20Compendium.js, book identity and direct-link planning
- Scope: Compendium export only; campaign export is unchanged

## Symptom

The 1.5.0 toolbar appears on Out of the Abyss but is absent from the accessible
Storm King's Thunder book index. There is no visible error because pages that
do not identify themselves as book indexes intentionally do not mount the toolbar.

## Evidence

An authenticated request returned HTTP 200 with expansion 7387 and page 75774.
The heading and source label were both `Storm King's Thunder`. The current URL
contained `Storm%20King%27s%20Thunder`; the source href contained
`Storm King's Thunder`. URL parsing preserved the difference between `%27` and
the literal apostrophe, so the old string comparison returned `isIndex: false`.
The page contained valid direct compendium links and required source markers.

Two new regressions failed against 1.5.0 before the fix: the toolbar refused the
index, and link planning treated equivalent encoded links and an index self-link
as three separate entry requests instead of one.

## Repair

Compare validated URLs using a separate identity made from origin, individually
decoded path segments, and the validated expansion query. Segment boundaries,
literal percent signs, double encoding, case, system, origin and expansion remain
distinct. Do not decode an entire path into one string or rewrite original hrefs,
request URLs, captured attributes, or markup. Use the same identity for index
recognition, self-link removal and direct-link deduplication.

## Regression Coverage

- Encoded apostrophe in the current URL and literal apostrophe in the source href.
- Toolbar mounts idle for the observed Storm King's Thunder index shape.
- Equivalent direct links deduplicate while preserving all original link evidence.
- Encoded slash, real path separator, double encoding, encoded question mark and
  case differences do not collapse into the same identity.
- Existing origin, system, expansion, query and capture-failure guards still pass.
- The native Edge acceptance fixture uses the encoded-apostrophe index mismatch
  and verifies capture, ZIP delivery, cancellation, and responsive controls.