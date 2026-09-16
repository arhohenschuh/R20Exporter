# B015: Empty Entries Break Compendium Navigation

- Status: Fixed in 1.5.3
- Found: 2026-09-14, authenticated comparison of the Essentials Kit compendium
- Component: [src/R20Compendium.js](../../src/R20Compendium.js)
- Scope: Generic compendium traversal; no campaign or converter changes

## Evidence

The owner's 1.5.2 Essentials Kit capture contains 345 pages. An independent
same-book navigation walk found 475 distinct source-verified pages: all 345
stored pages match, while 48 empty placeholders and 82 attribute-only entries
are absent. The 82 entries contain native attributes but no body prose. Samples
include Fighting Style - Archery with Type=Fighting Style and Second Wind with
Type=Class Feature and Subtype=Fighter. These are omitted entry/metadata records,
not 82 missing rules descriptions.

The navigation chain proceeds from Young White Dragon, page 252519, to the empty
Artisan's Tools Proficiency page 254443, through empty lists, then to feature
pages beginning with Fighting Style - Archery, page 254362. All belong to the
selected expansion 4415. The original ZIP is unchanged: 20,008,629 bytes,
SHA-256 84E1EEF72ECE9748A239BE7B425FDB1741E5927C95AFA1CEA41C2B46B2CD79C6.

## Cause

The parser rejected an empty entry before extracting its next/previous links.
The collector therefore recorded the expected empty-page failure but never
discovered the remaining verified book navigation. Capture validity incorrectly
controlled whether traversal could continue.

## Repair

The entry collector can request parsing with allowEmpty enabled. Source identity,
selected expansion, response URL, source header and attribute structure checks
remain mandatory. Default parsing and book-index parsing still reject empty
content.

For a verified empty entry, discovery considers only explicitly same-expansion
native navigation, using the existing URL guards, deduplication, request budget
and cancellation. It ignores empty-page body links, queues the safe navigation,
then records empty-compendium-entry without writing page files or bundling that
page's assets. Attribute-only entries remain valid captures.

The report stays partial when empty pages are encountered. Wrong-source, login,
malformed and inaccessible responses do not supply navigation. The archive
format and normal catalogue/cross-reference policy are unchanged. This repairs
the implementation of [ADR-007](../adr/ADR-007-compendium-catalogue-discovery.md);
the accepted decision is not rewritten.

## Verification

- The two new chain regressions failed before the fix and pass afterward, using
  Essentials and unrelated book/document identities.
- Tests cover consecutive empty pages, native navigation loops, an attribute-only
  successor, ignored empty body links, unsafe targets, wrong-source and malformed
  responses, cancellation, request limits and truthful failed-page records.
- All 115 extension tests pass, including campaign and build regressions.
- Installed Edge acceptance passes ordinary capture and a two-empty-page chain:
  the latter saves two valid pages and one image, keeps two empty pages failed,
  and verifies the actual partial ZIP's member sizes, hashes and alias records.
  Cancellation and nonblank desktop/mobile toolbar checks also pass.

## Owner Capture

The owner's 1.5.3 Essentials capture was verified on 2026-09-14: all 427 eligible
pages match the authenticated same-book audit, including all 82 previously
omitted attribute-only entries. All 345 earlier pages and 67 image assets are
preserved. The 1,281 HTML fragments match, and all 4,060 native attribute rows
agree with their stored markup. No captured page belongs to another expansion.

The verified archive is 20,153,582 bytes, SHA-256
424130ECB1FB59A6F635FE16A595ED965189B1AEAA9B909E182C6045E2981E0A.
Its partial status is expected: 48 empty entries remain uncaptured and one
wrong-source response is rejected. The reported 503 requests and 27 aliases are
finite same-book discovery, not a crawl of the general compendium.

Existing ZIPs were not modified. Earlier captures require a new export to obtain
the restored entries. Source-side 404s and wrong-expansion responses remain
explicit failures, not repaired URLs.