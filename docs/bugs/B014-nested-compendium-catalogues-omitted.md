# B014: Official Host Aliases and Nested Catalogues Omit Compendium Entries

- Status: Fixed in 1.5.2 candidate
- Found: 2026-09-13, owner inspection of Phandelver and Below
- Component: src/R20Compendium.js and compendium toolbar counts
- Scope: Generic compendium discovery; no campaign or converter changes

## Evidence

The supplied 1.5.1 Shattered Obelisk archive planned two pages, captured its index,
and failed the generic Rules:Credits URL with HTTP 404. Its two appendix links
were excluded as outside-selected-compendium because they use https://roll20.net.

Authenticated browser inspection found ordinary server-rendered HTML, not hidden
JavaScript data. Both appendices are readable through app.roll20.net with the
same expansion 25525: Bestiary page 120472 has 28 explicit same-source monster
links; Magic Items page 120473 has 20 same-source item links. The landing page
is 118302. Native navigation exposes the working book-specific Credits page 118303.

The direct-host filter and flat traversal are independent defects: accepting the
official host alias alone still captures appendix lists without their entries.
The same discovery pattern can affect other books. Reported success for the old
direct-link scope does not prove nested catalogue coverage.

The first full capture also exposed valid nested duplicate content IDs in two
published items: Lightbringer (page 251262) and Tergon's Breastplate (page 251263).
Their source-identified outer wrapper contains another untagged pagecontent div.
The parser now selects the outermost wrapper and preserves the inner markup;
multiple independent top-level wrappers and wrong source IDs still fail closed.

## Repair And Tests

ADR-007 specifies the generic correction. Normalize only the known HTTPS host
alias for requests, follow explicitly source-bound catalogue links and native
navigation, deduplicate successful aliases by source/page ID and content, and
apply request limits throughout traversal. Preserve original link provenance.
Do not fix source typos or broken URLs by name matching.

Regression cases cover host lookalikes and credentials, nested children, native
navigation, cycles, source rejection, unrelated entry references, discovery
limits, equal-ID content conflicts and a broken direct link alongside a working
native target. The installed-extension fixture exercises a nested catalogue,
alias return link, nested content IDs, ZIP hashes, cancellation, and responsive
control layout. Screenshots must contain multiple pixel colors, not a blank frame.

## Remaining Source Issue

Shattered Obelisk's generic Credits link is an upstream 404. Capturing the
book-specific Credits page does not remove that failure. An export may contain
the useful catalogue and still correctly report partial because an original
source reference is unresolved. Original exports are not overwritten.