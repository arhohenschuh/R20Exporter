# R20Exporter Repository

## Fork boundary

This repository is the fork `arhohenschuh/R20Exporter` of `kakaroto/R20Exporter`. All writes go
to the fork only: pushes, tags, releases, issues, pull requests and comments. Nothing is ever
pushed, filed or posted to the upstream repository; `upstream` is a fetch-only remote.

The fork has GitHub issues disabled, and an unqualified `gh issue create` can resolve to the
upstream repository instead. Record defects in [`docs/bugs/`](bugs/README.md), and pass
`--repo arhohenschuh/R20Exporter` to every `gh` command that writes.

Configure every clone so the boundary is enforced, not just documented:

```powershell
git remote set-url --push upstream no-push://upstream-is-fetch-only
gh repo set-default arhohenschuh/R20Exporter
```

The same rule applies to the sibling fork `arhohenschuh/R20Converter`. On 13 November 2026 an
unqualified `gh issue create` there filed six issues upstream; R20Exporter had the same exposure
but nothing was written upstream. Its clone was configured as above the same day.

## Releases

Releases are annotated `vX.Y.Z` tags on `master` in the fork. The packaged extension, release
notes, checksums and receipts are kept under
`D:\Automation_Local\Infrastructure\Toolchains\r20exporter\<version>\`; no GitHub release page is
created.
