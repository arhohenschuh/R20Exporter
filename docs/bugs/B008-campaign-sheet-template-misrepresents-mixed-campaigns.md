# B008: Campaign sheet template misrepresents mixed-sheet campaigns

- **Status**: **Fixed** in 1.3.1 — `export_report.json` now carries one deterministic
  `character_sheets` row per character while retaining the old campaign-level summary.
- **Severity**: Major — downstream tools can select the wrong parser for most characters while the
  export itself remains complete and apparently healthy
- **Found**: 2026-08-22, auditing the retained *Curse of Strahd* export
- **Component**: `src/R20ExportManifests.js` (`detectCharacterSheet`, `R20ExportReport`)

## Symptom

`export_report.json` exposes one `character_sheet.template` value for a campaign. In a mixed-sheet
campaign that value is not representative of every character, but its singular shape invites a
consumer to treat it as authoritative.

The retained *Curse of Strahd* export reports:

```json
{
  "template": "dnd2024byroll20",
  "templates": ["dnd2024byroll20", "ogl5e"],
  "source": "page.CharacterSheetsManagerSingleton.sheets"
}
```

All 181 exported characters carry `charactersheetname`: 168 are `ogl5e` and 13 are
`dnd2024byroll20`. The singular template therefore describes only 13 of 181 characters.

## Cause

`detectCharacterSheet()` reports campaign-level evidence. When the live page exposes several
templates, it sorts their keys and assigns the first one to `template`. Its offline fallback scans
characters and returns the first `character_sheet` attribute it finds. Neither path records which
template belongs to which character, and neither reads the observed direct character field
`charactersheetname`.

## Evidence

- Archive: `Curse of Strahd_R20Export-1.0.0.zip`, 1,393,343,039 bytes,
  SHA-256 `E1A60DA954BB55FABB34CCF66072BD698CCDCD144DC349200B8F778D6A9B14A7`.
- Exporter: 0.15.0; report format 1.1.
- Character count: 181; `charactersheetname` present on 181; 168 `ogl5e`; 13
  `dnd2024byroll20`; zero unavailable or ambiguous direct values.

## Fix

Report format 1.3 adds `character_sheets`, sorted by character ID. Every row records character ID
and name, the resolved template and all observed templates, the source of the determination, an
explicit `available` / `ambiguous` / `unavailable` state, the direct `charactersheetname` value,
and every exact `character_sheet` attribute value. The existing campaign-level `character_sheet`
object remains for backward compatibility. `campaign.json` is not changed.

## Regression test

`tests/manifests.test.js` covers direct-field, exact-attribute, conflicting, and unavailable
characters. `tests/export.test.js` requires every fixture character to appear in the emitted
sidecar and retains the existing assertion that the Roll20 payload is unchanged.