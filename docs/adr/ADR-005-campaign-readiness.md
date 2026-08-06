# ADR-005: An export starts only when the campaign has demonstrably arrived

- **Status**: Accepted
- **Date**: 2026-08-06
- **Supersedes**: —
- **Superseded by**: —

## Context

ADR-001 gave the export a non-vacuity guard: compare what we exported against
what the live campaign holds, and report any gap. It was designed against the
failure "we never enumerated a collection we could have enumerated".

Measuring *Curse of Strahd* (181 characters, 363 handouts, 50 pages) showed a
failure it cannot see. For roughly two minutes after `window.Campaign` becomes a
usable object, **every collection on it is empty**. Both sides of the guard's
comparison read zero, they agree, and the report is clean. An export started in
that window produces an archive with nothing in it and announces success
(B006).

This is not a rare race. It scales with campaign size, so it is worst precisely
where an export is most expensive to repeat, and it is invisible on the small
campaigns one naturally tests with.

The tempting fix — "wait for Roll20 to say it is ready" — requires a readiness
signal on an unversioned private API. The editor's own loading overlay is still
displayed after the collections have arrived, so it is not that signal either.

## Decision

**Presence is not arrival. Two independent checks, both required.**

1. **A structural invariant, checked before anything runs.** Roll20 guarantees a
   campaign has at least one page. `Campaign.pages.models.length === 0`
   therefore means the data has not reached the browser, and the engine guard
   reports the campaign as *loading* — distinct from *not understood* — and
   refuses to start. This costs one assumption about Roll20's data model, not
   about its code.

2. **Evidence of quiescence, not a fixed delay.** Before parsing, the exporter
   samples `liveCollectionCounts()` every two seconds and proceeds only when two
   consecutive samples are identical across *all* collections. A campaign that
   is still filling cannot be mistaken for a finished one, and a campaign that
   is already loaded costs one extra sample.

The wait is bounded at three minutes. On expiry the export proceeds and the
report carries a note saying the campaign was still changing — a degradation the
reader can see, rather than a hang.

**The guard stays fatal, unlike the non-vacuity mismatch.** It runs before any
work has been done, so refusing costs the user a click. The count mismatch found
at the *end* of a two-hour export is reported loudly and never aborts, because
by then aborting is the more destructive choice.

## Alternatives considered

- **Wait a fixed number of seconds.** Rejected: it is a guess that is
  simultaneously too long for a small campaign and too short for a large one,
  and it turns into a support answer ("wait a bit longer") instead of a fix.
- **Poll a Roll20 readiness flag.** Rejected: no such flag is exposed, and the
  loading overlay contradicts the data — it is still up after the collections
  arrive.
- **Let the non-vacuity guard catch it at the end.** Rejected: it structurally
  cannot. Both of its numbers come from the same page, so they agree at zero.
  This is the ADR's whole reason to exist.
- **Disable the export button until ready.** Deferred, not rejected: it is
  better UX than an error message, but it needs the same signal this ADR builds,
  and the error is at least honest about why. Worth doing on top of this.

## Consequences

- A user who clicks Export too early gets a clear "the campaign has not finished
  loading" message instead of an empty zip. That is a visible behaviour change.
- Every export pays one extra two-second sample.
- If Roll20 ever ships a campaign with zero pages, the exporter will refuse it.
  That is the assumption being made, and it is recorded here so the next person
  knows where to look.
