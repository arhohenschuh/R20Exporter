# ADR-006: Separate Source-Scoped Compendium Capture

- Status: Accepted
- Date: 2026-09-13
- Supersedes: None

## Context

The owner requested optional export of a module's web compendium and asked the
Lead Architect to consult a Senior Developer before building a feasible release.
Authenticated discovery on the Out of the Abyss index found 59 direct entry URLs,
including Credits, but no adventure chapter links. Representative item and monster
requests returned server-rendered HTML, native attribute rows, numeric page IDs,
and an explicit selected expansion ID. Some illustrations sit outside pagecontent.

Campaign export starts from editor-only globals. Web compendiums are a separate
data source and are not necessarily complete copies of an adventure. A generic
recursive crawler or a campaign checkbox would obscure those boundaries.

## Decision

Implement a standalone, opt-in Export Compendium action on an identifiable book
index, with a separate isolated-world content script. Preserve default campaign
behavior and share only existing ZIP I/O and image decoding. The Senior Developer
consultation endorsed this boundary and required source proof, terminal outcomes,
raw-data fidelity, and separate exact-build validation.

Freeze the selected index's direct links. Preserve their raw hrefs and categories
while deriving HTTPS request URLs pinned to the selected expansion. Do not
recursively crawl entry references, use private campaign globals, or fetch a
different expansion. Verify each response's expansion and page identity; reject
ambiguous, inaccessible, redirected, or wrong-source content.

Parse downloaded HTML inside an inert HTML template. Capture only DOM-serialized
content, native ordered attributes, and entry illustrations. Do not claim original
HTTP-byte fidelity, rewrite values, inject captured HTML into the UI, or store
logged-in chrome, credentials, cookies, or unrelated scripts. Reuse the browser's
existing authenticated session for same-origin page requests; omit credentials
from allowed Roll20 media requests.

Use a standalone versioned archive and explicit scoped-completeness report, not
a synthetic campaign payload. Missing or unsupported content remains visible.
Bound requests, retries, timeouts, body sizes and archive size. Cancellation stops
work and suppresses ZIP delivery; diagnostic reports remain available. The public
extension distribution must contain code and licenses only, never captured books.

## Alternatives

- Playwright-only collection: useful for discovery and independent acceptance,
  but unnecessary as the production interface because authenticated page requests
  already expose the required data.
- Add compendium capture to campaign export: deferred. It requires explicit book
  selection and introduces coupled failure handling without extending proven coverage.
- Reuse the campaign state machine or instantiate fake campaign records: rejected.
  Campaign engine guards, report semantics and converter contracts do not apply.
- Recursive crawling or guessed same-name entries: rejected because it would
  silently broaden source scope and mix sourcebooks or editions.
- Preserve complete HTTP documents: rejected because authenticated page chrome is
  unrelated to the requested content. DOM serialization is declared explicitly.

## Consequences

The first release adds an independently initiated compendium ZIP, not converter
support or whole-book completeness. It introduces a Roll20 HTML-layout dependency
that must fail visibly when required source markers change. Browser tests must
exercise the packaged entry point, authentication, image handling, cancellation,
and desktop/mobile control layout; campaign storage and asset regressions remain
required because their narrow I/O implementation is shared.