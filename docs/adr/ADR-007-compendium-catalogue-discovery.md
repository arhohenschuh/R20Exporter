# ADR-007: Source-Scoped Nested Catalogue and Navigation Discovery

- Status: Accepted
- Date: 2026-09-13
- Amends: The direct-links-only discovery and exact-host decisions in ADR-006
- Authority: Owner-reported missing Shattered Obelisk content, request to check
  other compendiums, and authorization to build, commit, annotate and push the fix

## Context

The 1.5.1 exporter reports one linked page for Shattered Obelisk because both
appendix URLs use the official roll20.net host rather than app.roll20.net. The
appendices contain a further 28 monster and 20 item links. Credits also has a
broken direct URL while the native book navigation supplies a working URL.
Similar nested catalogues exist in other purchased books. A flat first-level
count cannot establish catalogue completeness.

## Decision

Allow exactly the HTTPS roll20.net compendium host as an alias of app.roll20.net,
canonicalizing only the request copy. Preserve every original href and keep all
scheme, user-info, port, system, query and source-expansion checks.

Start from the selected book index and its direct links. Expand nested body links
only from verified pages without native attribute rows and only when each target
explicitly names the selected expansion. Follow native .page-links navigation
only when explicitly source-bound. Do not recursively crawl ordinary entry
cross-references or unqualified nested links. Every response must independently
prove its expansion and page ID before its links are trusted.

Use a bounded queue and URL identities to break cycles. Distinct URLs for the
same verified expansion/page ID are aliases only when all captured content
fragments agree. Preserve the alias request and its discovery/attempt evidence
without duplicating content. Conflicting content for an identical page ID fails
the capture rather than discarding it. The request ceiling applies during discovery.

Retain the existing archive format with additive requestAliases and discovery
metadata. Declare scope selected-book-catalogue-and-navigation. Show index links
before work starts and update discovered/captured page counts as work progresses.

Broken source URLs stay failed. A working native navigation target does not
justify silently rewriting a failed source link based on its title. The archive
retains both facts and stays partial until that source issue is dispositioned.

## Consequences

Books organized through appendices become exportable without a module-specific
exception table or private API. Additional requests are bounded, cancellable and
source-verified. The exporter still does not claim whole-book or unlinked-content
coverage. Existing captures of only first-level catalogues may need re-exporting;
an older complete-within-index status was a narrower claim, not proof of full
catalogue coverage. ADR-006 remains preserved as the historical design decision.