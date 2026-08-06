# ADR-001: Sidecar manifests, never a transformed record

- **Status**: Accepted
- **Date**: 2026-08-06
- **Applies to**: 0.12.0 (R1) onward

## Context

Every time the downstream pipeline needed ground truth — pre-migration weapon
payloads, stripped-art audits, "is this a converter defect or an exporter
defect?" — the answer came from **raw exported values**. An exporter that
"helpfully" cleans data destroys the only witness. One conversion shipped 116
assets missing with exit code 0 (Conv-B049); the export had said nothing at all.

Two things were therefore needed at once, and they pull in opposite directions:
more information about the export, and no change to the export.

## Decision

All new intelligence goes into **sidecar files** that a consumer may ignore:

| File | Content |
|---|---|
| `export_report.json` | every referenced asset with its outcome, the host and resolution that served it, byte count, sha256, and every candidate tried; per-collection counts exported *vs* live; the character sheet template |
| `integrity.json` | referential problems **flagged, never repaired** — dangling `represents`, dangling folder entries, dangling journal links, unusable roll payloads, pages that exported empty but have a thumbnail |
| `index.json` | every Roll20 id → `{type, name}`, so downstream link rewriting is a lookup instead of a reverse-engineered hash |

**No Roll20-sourced field is added, removed, reordered or rewritten.** The one
pre-existing exception is the exporter's own `R20Exporter_format` stamp, which
already lived in `campaign.json` before this decision and stays at `"1.0"` —
sidecars are detected by their presence, not by a version bump, so no consumer
that compares that string can break.

Sidecar entries are **sorted** and zip entry timestamps are **pinned** to the
1980 zip epoch, so two exports of an unchanged campaign differ only in the
fields Roll20 itself moves (`tools/volatile-fields.json`).

## Consequences

- A miss is now countable, and the export dialog stays open when the count is
  non-zero. A zero-miss export auto-closes exactly as before.
- Anything that wants the *corrected* data must correct it itself. That is the
  point: the archive keeps the evidence.
- Three extra files at the zip root. `R20Converter.getZipFile` opens members by
  name and never enumerates the root, so unknown members are inert.

## Alternatives considered

- **Repair on export** (fix null rolls, re-point dead links, normalise text
  encodings). Rejected: it destroys the witness, and one confirmed
  "serialisation bug" (Conv-B052) turned out to be a downstream tool
  re-emitting data the exporter had produced correctly. Fixing it here would
  have been the wrong component *and* a transformation of the record.
- **A single combined manifest.** Rejected: the report is written at the end of
  an export and is about *our* behaviour; the integrity and index manifests are
  pure functions of the campaign and are useful without an export at all.
