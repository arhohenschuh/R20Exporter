"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { runZipExport, createExporter, waitFor } = require("./harness/roll20.js");
const { buildCampaign, buildRoutes, DEAD_ASSET, collection, model } = require("./fixtures/campaign.js");
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
    assert.deepEqual(report.character_sheets, [
        {
            id: "-CHARACTERALIVE", name: "Sir Braford", template: null,
            templates: [], source: "unavailable", state: "unavailable",
            character_sheet_attribute: null, character_sheet_attributes: [],
            charactersheetname: null,
        },
        {
            id: "char-alive", name: "Erky Timbers", template: "OGL_2.0",
            templates: ["OGL_2.0"], source: "character-attribute:character_sheet",
            state: "available", character_sheet_attribute: "OGL_2.0",
            character_sheet_attributes: ["OGL_2.0"], charactersheetname: null,
        },
    ]);
    assert.equal(report.R20Exporter_report_format, "1.4");
    assert.equal(report.campaign.release, "jumpgate");
});

test("a referenced Map Pin keeps its complete page payload and parity count", async () => {
    const { contents } = await exportOnce();
    const campaign = JSON.parse(contents["campaign.json"]);
    const pin = campaign.pages[0].pins[0];
    assert.deepEqual(pin, {
        id: "pin-1",
        x: 350,
        y: 420,
        bgColor: "#242424",
        shape: "teardrop",
        icon: "base-dot",
        pinImage: "/images/pin-marker.png",
        customizationType: "icon",
        useTextIcon: true,
        iconText: "1",
        link: "handout-1",
        linkType: "handout",
        subLink: "1. Entrance",
        subLinkType: "headerGM",
        title: "1. Entrance",
        notes: "",
        gmNotes: "The old stairs descend into darkness.",
        tooltipImage: "https://files.d20.io/images/pin-tooltip/med.png?9",
        visibleTo: "",
        tooltipVisibleTo: "",
        scale: 1,
    });
    const report = JSON.parse(contents["export_report.json"]);
    assert.equal(report.collections.pins.exported, 1);
    assert.equal(report.collections.pins.live, 1);
    assert.equal(report.collections.pin_references.exported, 1);
    assert.equal(report.collections.pin_references.live, 1);
    assert.equal(report.pin_source, "pages.thepins");
    assert.deepEqual(report.pin_closure, { pass: true, pins: 1, references: 1 });
    assert.ok(Object.keys(contents).some((name) => /\/pins\/pin-1_pin\.png$/.test(name)));
    assert.ok(Object.keys(contents).some((name) => /\/pins\/pin-1_tooltip\.png$/.test(name)));
    const index = JSON.parse(contents["index.json"]);
    assert.equal(index.scene_pins.totals.pins, 1);
    assert.equal(index.scene_pins.totals.anchors, 1);
    assert.equal(index.scene_pins.totals.text_labels, 1);
});

test("a Jumpgate export refuses to run when the Pin collection is unavailable", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    for (const page of Campaign.pages.models) delete page.thepins;
    const page = createExporter(exportOptions({ campaign: Campaign, jukebox: Jukebox }));
    page.exporter.pinInitializationTimeout = 50;
    await page.exporter.exportCampaignZip();
    await waitFor(() => page.exporter.console.closeShown, {
        label: "the unavailable Pin collection refusal",
        timeout: 5000,
    });
    assert.equal(page.recorder.saved.length, 0);
    assert.equal(page.exporter.zip, null);
    assert.equal(page.exporter.console.closeShown, true);
    page.stop();
});

test("a Jumpgate export refuses a Handout reference whose Pin is absent", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    const pins = Campaign.pages.models[0].thepins;
    pins.models.length = 0;
    pins.length = 0;
    const page = createExporter(exportOptions({ campaign: Campaign, jukebox: Jukebox }));
    await page.exporter.exportCampaignZip();
    await waitFor(() => page.exporter.console.closeShown, {
        label: "the Pin closure refusal",
        timeout: 5000,
    });
    assert.equal(page.recorder.saved.length, 0);
    assert.equal(page.exporter.zip, null);
    assert.equal(page.exporter.console.closeShown, true);
    page.stop();
});

test("an archived page wakes as soon as its Pin-only content arrives", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    const archived = Campaign.pages.models[0];
    const pin = archived.thepins.models[0];
    archived.mapPins = archived.thepins;
    delete archived.thepins;
    archived.fullyLoaded = false;
    archived.thegraphics = { models: [], length: 0, toJSON: () => [] };
    archived.thetexts = { models: [], length: 0, toJSON: () => [] };
    archived.thepaths = { models: [], length: 0, toJSON: () => [] };
    archived.mapPins = { models: [], length: 0, toJSON() { return this.models.map((model) => model.toJSON()); } };
    archived.doors = { models: [], length: 0, toJSON: () => [] };
    archived.windows = { models: [], length: 0, toJSON: () => [] };
    archived.fullyLoadPage = () => setTimeout(() => {
        archived.mapPins.models.push(pin);
        archived.mapPins.length = 1;
        archived.fullyLoaded = true;
    }, 100);

    const page = await runZipExport(exportOptions({ campaign: Campaign, jukebox: Jukebox }));
    const campaign = JSON.parse(page.contents["campaign.json"]);
    assert.equal(campaign.pages.find((item) => item.id === "page-1").pins.length, 1);
    page.stop();
});

test("an archived Jumpgate page awaits its real mapPins initializationPromise", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    const loaded = Campaign.pages.models[0];
    loaded.mapPins = loaded.thepins;
    delete loaded.thepins;

    const archived = Campaign.pages.models[1];
    delete archived.thepins;
    archived.fullyLoaded = false;
    archived.thetexts = collection([model({ id: "text-2", text: "Loading marker" })]);
    const pin = model({
        id: "pin-2",
        x: 70,
        y: 140,
        link: "handout-2",
        linkType: "handout",
        subLink: "2. Vault",
        subLinkType: "headerGM",
        useTextIcon: true,
        iconText: "2",
        visibleTo: "",
    });
    const handout = model({
        id: "handout-2",
        name: "Vault",
        avatar: "",
        inplayerjournals: "",
        controlledby: "",
        pins: JSON.stringify([{
            id: "pin-2", page: "page-2", subLink: "2. Vault", subLinkType: "headerGM",
        }]),
        notes: "",
        gmnotes: "",
    });
    Campaign.handouts = collection([...Campaign.handouts.models, handout]);
    archived.fullyLoadPage = () => {
        archived.fullyLoaded = true;
        archived.mapPins = collection([]);
        archived.mapPins.initializationPromise = new Promise((resolve) => setTimeout(() => {
            archived.mapPins.models.push(pin);
            archived.mapPins.length = 1;
            resolve();
        }, 1500));
    };

    const page = await runZipExport(exportOptions({ campaign: Campaign, jukebox: Jukebox }));
    const campaign = JSON.parse(page.contents["campaign.json"]);
    assert.equal(campaign.pages.find((item) => item.id === "page-2").pins[0].id, "pin-2");
    assert.equal(JSON.parse(page.contents["export_report.json"]).pin_source, "pages.mapPins");
    page.stop();
});

test("a failed Pin image remains visible in the asset report", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    const source = Campaign.pages.models[0].thepins.models[0].toJSON();
    source.pinImage = DEAD_ASSET;
    Campaign.pages.models[0].thepins = {
        models: [source],
        length: 1,
        toJSON() { return JSON.parse(JSON.stringify(this.models)); },
    };
    const { contents } = await exportOnce({ campaign: Campaign, jukebox: Jukebox });
    const report = JSON.parse(contents["export_report.json"]);
    const failed = report.assets.filter((asset) => /\/pins\/pin-1_pin/.test(asset.path));
    assert.equal(failed.length, 1);
    assert.equal(failed[0].outcome, "failed");
    assert.ok(failed[0].reason);
    assert.equal(Object.keys(contents).some((name) => /\/pins\/pin-1_pin\./.test(name)), false);
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
