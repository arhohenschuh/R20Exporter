# ADR-001: Sidecar manifests, never a transformed record

- **Status**: Accepted
- **Date**: 2026-08-06
- **Applies to**: 0.12.0 (R1) onward
- **Amended**: 2026-08-14 (1.1.0) — folder structure, renderability, and one
  declared exception to "never a transformed record"

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

## Amendment, 2026-08-14 (1.1.0)

### The index records the folder tree, not just the documents

Downstream converted 18 adventure modules that preserved every one of **5,108
journal entries** and put all of them in a single flat folder. Every count
matched; the campaign's navigation was gone. Restoring it cost a separate tool
chain, two gates and 18 re-releases.

Document conservation is not navigation conservation, and nothing in the export
let anyone tell them apart without re-deriving the tree from raw
`campaign.json`. `index.json` therefore gains:

- `entries.<id>.folder` — the `"/"`-joined folder path, or `null` at the root;
- `folders.<journal|jukebox>` — `folders`, `max_depth`, `documents_in_folders`,
  `documents_at_root`, `duplicate_paths` and the sorted `paths` list.

Empty branches are counted as folders and duplicate sibling names are reported
rather than collapsed — Roll20 permits both, and a consumer that silently drops
either has changed the campaign. Measured on *Storm over Savage Frontier*: 68
journal folders, depth 3, 865 documents placed, 59 at the root.

`index.json` moves to format `1.1`.

### The one Roll20-sourced field we do rewrite, now declared

`_addOrphanedElementsToFolder` appends handouts, PDFs and tracks that belong to
no folder onto the **root** of `journalfolder` / `jukeboxfolder`, and it has done
so since long before ADR-001. It predates this decision and it is load-bearing —
without it an orphaned handout is invisible to the journal walk and never
reaches the zip — but leaving it undeclared meant `campaign.json`'s tree was
not the raw Roll20 tree, which quietly disqualifies the export as the oracle for
"did the folder structure survive".

It stays, and `export_report.json` now carries `folder_orphans_appended`
(`jukebox`, `journal_handouts`, `journal_pdfs`) so a consumer can subtract it.
This is the *only* such exception; everything else in the invariant holds.

### A name the target cannot render is flagged, not fixed

The zip member keeps the extension the source URL advertises — that is ADR-003,
and it is load-bearing: the converter looks the member up by that name. But
Foundry silently refuses to draw a path outside
`CONST.IMAGE_FILE_EXTENSIONS`, and **139 members across five archived exports**
(`.svg&cb=5`, `.jfif`) were in exactly that state. The converter shipped for a
week believing it had fixed this.

Each asset record therefore gains `renderable`, and the totals gain
`not-renderable`. The file is not renamed and the bytes are not touched — the
consumer is simply told. `export_report.json` moves to format `1.2`.

