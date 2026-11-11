# ADR-008: Stage every ZIP member on arrival

- **Status**: Accepted
- **Date**: 2026-11-10
- **Amends**: [ADR-004](ADR-004-opfs-and-modern-zip.md), which covers where the finished archive is written; this ADR covers where its members wait until then
- **Applies to**: 1.5.5 onward

## Context

ADR-004 moved the **finished** ZIP to a save handle or OPFS. Every **member**,
including downloaded assets and exporter-built JSON and HTML, was still held as a
browser `Blob` in `zip.fs` from arrival until `exportWritable()` read it at the end.
On one long, interrupted DotMM export, 8,812 of 9,079 retained Blobs were unreadable
at that point. The final step threw `NotReadableError`, and hours of downloads were
lost ([B012](../bugs/B012-retained-blobs-unreadable-at-finalization.md)).

Clean controls did not reproduce the loss, and the browser-internal mechanism is
unconfirmed. The exporter can still remove its dependence on Blob lifetime, whatever
that mechanism is.

## Decision

**Read each member once on arrival, persist those bytes to OPFS and keep only a file
handle until the ZIP is written.**

- `R20Archive.openStagingStore()` creates one directory per export,
  `R20Exporter-staging-<epoch-ms>-<random>`, and writes one file per member through
  `createWritable()`.
- `R20Archive.addMember()` adds the zip entry **when the member arrives**, so member
  order stays the same and determinism is preserved (ADR-001). Its `zip.Reader`
  subclass opens the staged file only when zip.js writes that entry, and it fails
  with the member's path if the file is missing or has the wrong size.
- The asset's SHA-256 is computed from the same read that is persisted, so the
  report hash and the ZIP bytes come from one buffer.
- At most 16 members are read and written at once, which bounds peak memory.
  A member whose staging does not finish within 120 s keeps its Blob.
- **Degradation is per member and reported.** If OPFS is unavailable, or a write
  fails, that member keeps its Blob, as all members did in 1.5.4. `export_report.json`
  gets one `B012:` note with the count and first reason.
- The staging directory is removed when the export ends, whether it succeeds or not.
  Directories older than 48 hours are removed when the next export starts. Newer
  directories may belong to an export running in another tab.

The ZIP layout, member names, member order and pinned dates are unchanged. The
`export_report.json` format is unchanged; the degradation uses the existing `notes`.

## Alternatives considered

- **Stage downloads only.** Rejected. The unreadable set was store-wide, and B012's
  arithmetic shows exporter-built JSON/HTML Blobs were lost too.
- **Keep members as `Uint8Array` in page memory.** Rejected. Thousands of maps would
  remain in the renderer heap for hours, replacing a Blob-lifetime risk with an
  out-of-memory risk.
- **Stream members into the ZIP as they arrive.** Rejected. Arrival order is network
  order, so member order and the two-export determinism gate (ADR-001) would be lost.
  The finished archive would also need a writable held open for the whole export.
- **One append-only pack file.** Rejected. Its swap file would hold uncommitted bytes
  for the whole export, and one failed write would affect every member.

## Consequences

- An export temporarily needs free browser storage roughly equal to the campaign's
  size. Without a save location, the OPFS staging ZIP needs roughly the same amount
  again. A failed staging write degrades only that member, and the report says so.
- In real Edge, 1,500 members totaling 241.7 MB were staged in 2.4 s, which is
  negligible beside download time.
- The test harness now gives every synthetic page an in-memory OPFS by default,
  matching Chrome and Edge, so the whole suite exercises staging. Tests for a
  browser without OPFS pass their own `navigator`.
- Compendium capture (ADR-006) still uses `addBlob`. Its archive is capped at
  512 MiB and has not shown B012. Adopting `addMember` there is a contained follow-up
  if it ever does.

## Amendment, 2026-11-11 (1.5.6)

The follow-up became necessary: *Monsters of the Multiverse* needs about 1 GB and
failed at the 512 MiB cap ([B018](../bugs/B018-compendium-archive-size-limit.md)).
The compendium toolbar now opens the same staging store and adds every member
through `addMember`. With staging the stored-content cap is 4 GiB; without it,
members stay Blobs and the 512 MiB cap remains. A failed staging write is fatal
for a compendium capture, because the collector has already hashed and recorded
the member. The report states the storage mode and cap.
