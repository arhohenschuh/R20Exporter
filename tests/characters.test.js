"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    checkEngineGlobals,
    sameCollectionCounts,
    characterAttributeSummary,
} = require("../src/R20ExportManifests.js");
const { createExporter, runZipExport, readZip, waitFor } = require("./harness/roll20.js");
const { buildCampaign, buildRoutes, collection, model } = require("./fixtures/campaign.js");

function options(overrides = {}) {
    const { Campaign, Jukebox } = buildCampaign();
    return Object.assign({ campaign: Campaign, jukebox: Jukebox, routes: buildRoutes(), title: "Curse of Strahd" }, overrides);
}

test("a campaign that has not arrived is reported as loading, not as understood", () => {
    const arriving = {
        Campaign: {
            toJSON: () => ({}),
            characters: { models: [] },
            handouts: { models: [] },
            pages: { models: [] },
            players: { models: [] },
        },
        BackboneFirebase: function () {},
        campaign_id: 1,
        d20_account_id: 2,
    };
    const guard = checkEngineGlobals(arriving);
    assert.equal(guard.ok, false);
    assert.deepEqual(guard.missing, [], "nothing is missing -- the data has simply not arrived");
    assert.equal(guard.loading.length, 1);
    assert.match(guard.loading[0].why, /still loading/);

    arriving.Campaign.pages.models = [{}];
    assert.equal(checkEngineGlobals(arriving).ok, true);
});

test("counts are compared as a whole, so one collection still filling is not stable", () => {
    assert.equal(sameCollectionCounts({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
    assert.equal(sameCollectionCounts({ a: 1, b: 2 }, { a: 1, b: 3 }), false);
    assert.equal(sameCollectionCounts({ a: 1 }, { a: 1, b: 0 }), false);
    assert.equal(sameCollectionCounts(null, { a: 1 }), false);
});

test("an export refuses to start while the campaign is still arriving", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    const pages = Campaign.pages.models;
    Campaign.pages = collection([]);
    const page = createExporter(options({ campaign: Campaign, jukebox: Jukebox }));
    await page.exporter.exportCampaignZip();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(page.recorder.saved.length, 0, "an empty archive must never be produced");
    assert.equal(page.recorder.entries.length, 0);
    Campaign.pages = collection(pages);
    page.stop();
});

test("the export waits until the collection counts stop moving", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    const all = Campaign.handouts.models;
    // The campaign arrives in two instalments, as a large one does in the browser.
    Campaign.handouts = collection(all.slice(0, 0));
    const page = createExporter(options({ campaign: Campaign, jukebox: Jukebox }));
    setTimeout(() => { Campaign.handouts = collection(all); }, 300);

    page.exporter.exportCampaignZip();
    await waitFor(() => page.recorder.saved.length > 0, { label: "the export to finish", timeout: 20000 });
    const contents = await readZip(page.sandbox, page.recorder.saved[0].file);
    const report = JSON.parse(contents["export_report.json"]);
    assert.equal(report.collections.handouts.exported, all.length);
    assert.deepEqual(report.collection_mismatches, []);
    page.stop();
});

test("a character sheet that never loads is counted, and does not stall the export", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    const ghost = model(
        {
            id: "char-ghost",
            name: "Never Loads",
            avatar: "",
            inplayerjournals: "",
            controlledby: "",
            bio: "",
            gmnotes: "",
            defaulttoken: "",
            attributes: [],
            abilities: [],
        },
        { _getLatestBlob: (field, cb) => cb("") }
    );
    ghost.attribs = collection([]);
    ghost.abilities = collection([]);
    Campaign.characters = collection([...Campaign.characters.models, ghost]);

    const page = createExporter(options({ campaign: Campaign, jukebox: Jukebox }));
    // A Firebase reference that never answers is what GH #34 reported.
    page.sandbox.BackboneFirebase = function () {
        this.reference = { once: () => new Promise(() => undefined) };
    };
    page.exporter.loadCharacterAttributes = (model) => page.exporter.constructor.prototype.loadCharacterAttributes.call(page.exporter, model, 50);

    page.exporter.exportCampaignZip();
    await waitFor(() => page.recorder.saved.length > 0, { label: "the export to finish despite a hung sheet", timeout: 60000 });
    const contents = await readZip(page.sandbox, page.recorder.saved[0].file);
    const report = JSON.parse(contents["export_report.json"]);
    assert.equal(report.character_attributes.total, 3);
    assert.equal(report.character_attributes.incomplete.length, 1);
    assert.equal(report.character_attributes.incomplete[0].id, "char-ghost");
    page.stop();
});

test("the attribute summary names every character that exported without a sheet", () => {
    const summary = characterAttributeSummary({
        characters: [
            { id: "b", name: "Loaded", attributes: [{ name: "hp", current: "1" }] },
            { id: "a", name: "Empty", attributes: [] },
            { id: "c", name: "Also empty" },
        ],
    });
    assert.equal(summary.total, 3);
    assert.equal(summary.loaded, 1);
    assert.deepEqual(summary.incomplete.map((c) => c.id), ["a", "c"]);
});

test("the extension injects itself as a MAIN-world content script", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
    const script = manifest.content_scripts[0];
    assert.equal(script.world, "MAIN", "page CSP blocks a script tag we inject ourselves");
    assert.deepEqual(script.js, [
        "libs/FileSaver/FileSaver.js",
        "libs/zipjs/zip-fs.js",
        "src/R20ExportManifests.js",
        "src/R20Exporter.js",
    ]);
    assert.equal(manifest.web_accessible_resources, undefined, "nothing needs to be web-accessible any more");
    for (const file of script.js) {
        assert.ok(fs.existsSync(path.join(__dirname, "..", file)), file + " is listed in the manifest but not shipped");
    }
});
