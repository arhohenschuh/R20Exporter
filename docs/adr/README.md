# Architecture Decision Records

Significant decisions for R20Exporter, as lightweight
[ADRs](https://adr.github.io/): the context that forced the decision, the
decision, the alternatives rejected, and the consequences accepted.

ADRs are immutable once accepted. If a decision changes, a **new** ADR
supersedes the old one, and the old one is marked `Superseded by ADR-XXX`.
Code that exists because of a decision here carries a short comment naming it.

| ADR | Title | Status |
| --- | ----- | ------ |
| [ADR-001](ADR-001-sidecar-manifests.md) | Sidecar manifests, never a transformed record | Accepted |
| [ADR-002](ADR-002-testing-in-a-synthetic-page.md) | Test the shipped code in a synthetic Roll20 page | Accepted |
| [ADR-003](ADR-003-asset-candidate-ladder.md) | One candidate ladder owns host and resolution selection | Accepted |

The release plan these decisions serve is [ROADMAP.md](ROADMAP.md); defects are
recorded in [../bugs](../bugs).
