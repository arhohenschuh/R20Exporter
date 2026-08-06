"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { runZipExport, createExporter, waitFor } = require("./harness/roll20.js");
const { buildCampaign, buildRoutes, DEAD_ASSET } = require("./fixtures/campaign.js");
const { diffExports } = require("../tools/diff-exports.js");

function exportOptions(overrides = {}) {
    const { Campaign, Jukebox } = buildCampaign();
    return Object.assign({ campaign: Campaign, jukebox: Jukebox, routes: buildRoutes(), title: "Sunless Citadel" }, overrides);
}

async function exportOnce(overrides) {
    const page = await runZipExport(exportOptions(overrides));
    page.stop();
    return { page, contents: page.contents };
}

test("an export carries the three sidecars next to campaign.json", async () => {
    const { contents } = await exportOnce();
    for (const name of ["campaign.json", "export_report.json", "integrity.json", "index.json"]) {
        assert.ok(contents[name] !== undefined, "missing " + name);
    }
    // ADR-001: the record itself is untouched.
    const campaign = JSON.parse(contents["campaign.json"]);
    assert.equal(campaign.release, "jumpgate");
    assert.equal(campaign.R20Exporter_format, "1.0");
    assert.equal(campaign.characters.length, 2);
});

test("a dead asset is reported with a reason instead of vanishing", async () => {
    const { contents } = await exportOnce();
    const report = JSON.parse(contents["export_report.json"]);
    const dead = report.assets.filter((a) => a.url === DEAD_ASSET);
    assert.equal(dead.length, 1, "the dead asset must appear exactly once");
    assert.equal(dead[0].outcome, "failed");
    assert.ok(dead[0].reason, "a failure must carry a reason");
    assert.ok(dead[0].attempts.length >= 4, "every resolution variant should be recorded as an attempt");
    assert.equal(report.totals.failed, 1);
    assert.equal(report.totals.pending, 0, "no asset may be left unresolved");
});

test("every bundled asset in the report is really in the zip", async () => {
    const { contents } = await exportOnce();
    const report = JSON.parse(contents["export_report.json"]);
    const bundled = report.assets.filter((a) => a.outcome !== "failed" && a.outcome !== "skipped");
    assert.ok(bundled.length > 0);
    for (const asset of bundled) {
        assert.ok(contents[asset.path] !== undefined, "report claims " + asset.path + " which is not in the zip");
        assert.equal(contents[asset.path].length, asset.bytes);
    }
});

test("report counts match the live campaign, and the sheet template is recorded", async () => {
    const { contents } = await exportOnce();
    const report = JSON.parse(contents["export_report.json"]);
    assert.deepEqual(report.collection_mismatches, []);
    assert.equal(report.collections.characters.exported, 2);
    assert.equal(report.collections.characters.live, 2);
    assert.equal(report.collections.graphics.exported, 4);
    assert.equal(report.collections.graphics.live, 4);
    assert.equal(report.character_sheet.template, "OGL_2.0");
    assert.equal(report.campaign.release, "jumpgate");
});

test("a collection the exporter never enumerated is caught, not reported as complete", async () => {
    const page = await runZipExport(exportOptions());
    // Simulate the vacuous case: the page has two characters, the export shipped one.
    page.exporter.campaign.characters.pop();
    page.exporter.report.setCollectionCounts(
        page.sandbox.exportedCollectionCounts(page.exporter.campaign),
        page.exporter._live_counts
    );
    assert.deepEqual(JSON.parse(JSON.stringify(page.exporter.report.collectionMismatches)), [
        { collection: "characters", exported: 1, live: 2 },
    ]);
    page.stop();
});

test("the integrity manifest finds the planted defects", async () => {
    const { contents } = await exportOnce();
    const integrity = JSON.parse(contents["integrity.json"]);
    assert.equal(integrity.totals["dangling-token-represents"], 1);
    assert.equal(integrity.totals["empty-page-with-thumbnail"], 1);
    assert.equal(integrity.totals["dangling-journal-link"], 1);
    assert.equal(integrity.totals["unusable-chat-roll"], 1);
});

test("the index resolves ids the converter would otherwise have to guess", async () => {
    const { contents } = await exportOnce();
    const index = JSON.parse(contents["index.json"]);
    assert.equal(index.entries["char-alive"].name, "Erky Timbers");
    assert.equal(index.entries["handout-1"].type, "handout");
    assert.equal(index.entries["page-1"].type, "page");
    assert.equal(index.entries["track-1"].type, "track");
});

test("zip entries carry a pinned timestamp", async () => {
    const { contents } = await exportOnce();
    const dates = new Set(Object.values(contents.__dates).map((d) => (d ? d.toISOString() : "unset")));
    assert.deepEqual([...dates], ["1980-01-01T00:00:00.000Z"]);
});

test("two exports of an unchanged campaign differ only in masked volatile fields", async () => {
    const first = await exportOnce();
    const second = await exportOnce();
    const raw = diffExports(first.contents, second.contents, { files: {} }.files || {});
    assert.ok(raw.changed.includes("export_report.json"), "generated_at should differ without the mask");

    const masked = diffExports(first.contents, second.contents);
    assert.deepEqual(masked.onlyLeft, []);
    assert.deepEqual(masked.onlyRight, []);
    assert.deepEqual(masked.changed, []);
});

test("the export refuses to start on a page it does not understand", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    const page = createExporter(exportOptions({ campaign: Campaign, jukebox: Jukebox }));
    page.sandbox.BackboneFirebase = undefined;
    await page.exporter.exportCampaignZip();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(page.recorder.saved.length, 0, "nothing may be written when the guard fails");
    assert.equal(page.exporter.zip, null);
    page.stop();
});

test("the shipped version is the version in the manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
    const { R20EXPORTER_VERSION } = require("../src/R20ExportManifests.js");
    assert.equal(manifest.version, R20EXPORTER_VERSION);
});

test("the dialog can be dismissed once the run is over, and not before", async () => {
    const page = createExporter(exportOptions());
    assert.equal(page.exporter.console.closeShown, false, "the overlay must stay while the campaign is being read");
    page.exporter.exportCampaignZip();
    await waitFor(() => page.recorder.saved.length > 0, { label: "the export to finish" });
    assert.equal(page.exporter.console.closeShown, true);
    page.stop();
});

test("a refused export can still be dismissed", async () => {
    const page = createExporter(exportOptions());
    page.sandbox.BackboneFirebase = undefined;
    await page.exporter.exportCampaignZip();
    // Nothing runs after a guard refusal, so without this the dialog is stuck.
    assert.equal(page.exporter.console.closeShown, true);
    page.stop();
});

test("the dialog declares its own colours instead of inheriting Roll20's", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "R20Exporter.js"), "utf8");
    const css = source.slice(source.indexOf("/* The Modal (background) */"), source.indexOf(".replace(/modal/g"));
    for (const selector of [".modal-content", ".modal-content .log", ".modal-content .warn", ".modal-content .error"]) {
        const block = css.slice(css.indexOf(selector + " {"));
        const body = block.slice(0, block.indexOf("}"));
        assert.match(body, /color:/, selector + " must set a text colour; Roll20's page colour is near-white");
    }
});
