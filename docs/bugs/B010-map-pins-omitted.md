# B010: Jumpgate Map Pins are omitted while collection parity reports complete

- **Status**: **Fixed** in 1.4.0 - complete Pin records are exported per page and participate in readiness, parity, and reference-closure gates
- **Severity**: Critical - official adventure area keys disappear even though the export reports complete page graphics
- **Found**: 2026-08-27, during owner inspection of *Dungeon of the Mad Mage*
- **Component**: `src/R20Exporter.js` (`parsePage`, `_parseCampaignDelayed`, `_addPageToZip`), `src/R20ExportManifests.js`
- **Related**: B006, Conv-B057

## Symptom

A freshly deployed Roll20 *Dungeon of the Mad Mage* uses Map Pins for its numbered area keys. The 1.3.2 export converted without area numbers, while `export_report.json` reported exact live/export parity for all 4,008 graphics.

The export retained 1,620 unique Handout-side Pin references across 33 Handouts and 26 pages, including the heading `38. Secret Tunnel`, but contained no Pin objects. It therefore had no Pin coordinates, text labels, visibility, style, tooltip content, or complete Handout link payload.

## Cause

Map Pins are distinct, layerless `_type: "pin"` objects. They are not graphics. `parsePage()` enumerated only `thegraphics`, `thetexts`, `thepaths`, `doors`, and `windows`; collection counting covered the same surface. A perfect graphics count could not detect omitted Pins.

## Fix

The exporter now:

- discovers known or structurally identified Pin collections on each page, with campaign/API fallbacks;
- refuses a Jumpgate export when Pin collections are inaccessible;
- stores the complete source records in `page.pins[]`;
- includes Pins in stable-load and live/export parity counts;
- requires every Handout Pin reference to resolve to a unique finite-coordinate Pin on the same page;
- verifies Pin-to-Handout links and records independent integrity findings;
- bundles custom Pin and tooltip images under the owning page's `pins/` directory;
- records `pin_source`, `pin_closure`, and per-page `scene_pins` evidence.

No Roll20 Pin field is normalized or rewritten. Downstream conversion can therefore map the authoritative coordinates, label, visibility, Handout, heading anchor, and tooltip payload.

## Regression tests

The synthetic Jumpgate fixture carries a hidden text Pin linked to a GM-note heading. The positive test requires the complete Pin payload, image assets (including a relative URL), count parity, source evidence, reference closure, and Pin index entry. Negative controls independently remove the page Pin collection and the referenced Pin; both must refuse to produce a ZIP. An archived Pin-only page must wake as soon as its Pin collection arrives, and a failed Pin image must remain visible in the asset report without a ZIP member. Manifest tests cover inferred private collection names, empty pages, duplicate IDs, dangling references, mismatched Handout anchors, and Pin summary counts. The complete 1.4.0 suite passes 72/72.