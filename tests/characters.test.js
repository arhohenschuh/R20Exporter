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

for (const identity of ["document-alpha", "unrelated-document-beta"]) {
    for (const reason of ["timeout", "exception"]) {
        test(`B016 ${reason} records a failed read without inventing empty content: ${identity}`, () => {
            const page = createExporter();
            const timers = new Map();
            let timerId = 0;
            page.sandbox.setTimeout = (callback) => {
                timers.set(++timerId, callback);
                return timerId;
            };
            page.sandbox.clearTimeout = (identifier) => timers.delete(identifier);
            const data = { id: identity, name: "Example document" };
            let completions = 0;
            const source = { id: identity, _getLatestBlob() {
                if (reason === "exception") throw new Error("synthetic read failure");
            } };
            try {
                const operation = page.exporter.newPendingOperation("document read");
                page.exporter.getLatestBlob(source, "gmnotes", data, operation, () => completions++);
                for (const callback of Array.from(timers.values())) callback();
                assert.equal(Object.hasOwn(data, "gmnotes"), false);
                assert.equal(completions, 1);
                assert.equal(page.exporter.numPendingOperations, 0);
                assert.equal(timers.size, 0);
                const failures = page.exporter.report.toJSON().document_read_failures;
                assert.equal(failures.length, 1);
                assert.equal(failures[0].id, identity);
                assert.equal(failures[0].name, data.name);
                assert.equal(failures[0].field, "gmnotes");
                assert.equal(failures[0].reason, reason);
            } finally {
                page.stop();
            }
        });
    }
}

for (const settlement of ["success", "timeout"]) {
    test(`B016 callbacks after ${settlement} cannot mutate data or complete twice`, () => {
        const page = createExporter();
        const timers = new Map();
        let timerId = 0;
        page.sandbox.setTimeout = (callback) => {
            timers.set(++timerId, callback);
            return timerId;
        };
        page.sandbox.clearTimeout = (identifier) => timers.delete(identifier);
        let deliver;
        let completions = 0;
        const source = { id: "late-document", _getLatestBlob(field, callback) { deliver = callback; } };
        const data = { name: "Late document" };
        try {
            const operation = page.exporter.newPendingOperation("document read");
            page.exporter.getLatestBlob(source, "notes", data, operation, () => completions++);
            if (settlement === "success") deliver(escape("original text"));
            else for (const callback of Array.from(timers.values())) callback();
            const settled = JSON.stringify(data);
            deliver(escape("late replacement"));
            assert.equal(JSON.stringify(data), settled);
            assert.equal(completions, 1);
            assert.equal(page.exporter.numPendingOperations, 0);
            assert.equal(timers.size, 0);
        } finally {
            page.stop();
        }
    });
}

for (const format of ["json", "zip"]) {
    for (const kind of ["character", "handout"]) {
        for (const reason of ["timeout", "exception"]) {
            test(`B016 ${format} export refuses a ${kind} ${reason} and ignores its late callback`, async () => {
                const fixture = options();
                const source = kind === "character" ? fixture.campaign.characters.models[0] : fixture.campaign.handouts.models[0];
                const field = kind === "character" ? "bio" : "notes";
                const original = source._getLatestBlob;
                let deliver;
                source._getLatestBlob = (key, callback) => {
                    if (key !== field) return original(key, callback);
                    deliver = callback;
                    if (reason === "exception") throw new Error("synthetic field failure");
                };
                const page = createExporter(fixture);
                const schedule = page.sandbox.setTimeout;
                page.sandbox.setTimeout = (callback, ms) => schedule(callback, [2000, 10000].includes(ms) ? 5 : ms);
                const messages = [];
                page.exporter.console.warn = (...args) => messages.push(args.join(" "));
                page.exporter.console.error = (...args) => messages.push(args.join(" "));
                try {
                    if (format === "zip") await page.exporter.exportCampaignZip();
                    else page.exporter.exportCampaignJson();
                    await waitFor(() => page.exporter.console.closeShown || page.recorder.saved.length, { label: "document refusal", timeout: 5000 });
                    assert.equal(page.recorder.saved.length, 0);
                    assert.equal(page.exporter.zip, null);
                    assert.equal(page.exporter.numPendingOperations, 0);
                    assert.equal(page.exporter.report.documentReadFailures.length, 1);
                    assert.equal(page.exporter.report.documentReadFailures[0].id, source.id);
                    assert.equal(page.exporter.report.documentReadFailures[0].field, field);
                    assert.equal(page.exporter.report.documentReadFailures[0].reason, reason);
                    assert.ok(messages.some(message => message.includes("Export canceled:")));
                    assert.equal(messages.some(message => message.includes("Congratulations!")), false);
                    const settled = JSON.stringify(page.exporter.campaign);
                    deliver(escape("late replacement"));
                    assert.equal(JSON.stringify(page.exporter.campaign), settled);
                    assert.equal(page.recorder.saved.length, 0);
                } finally {
                    page.stop();
                }
            });
        }
    }
}

for (const outcome of ["success", "timeout"]) {
    test(`B016 ${outcome} settles once while an unrelated operation remains pending`, () => {
        const page = createExporter();
        const timers = new Map();
        let timerId = 0;
        page.sandbox.setTimeout = (callback) => {
            timers.set(++timerId, callback);
            return timerId;
        };
        page.sandbox.clearTimeout = (identifier) => timers.delete(identifier);
        let deliver;
        let completions = 0;
        const data = {};
        try {
            const other = page.exporter.newPendingOperation("unrelated work");
            const operation = page.exporter.newPendingOperation("document read");
            page.exporter.getLatestBlob({ id: "with-other-work", _getLatestBlob(field, callback) { deliver = callback; } },
                "notes", data, operation, () => completions++);
            if (outcome === "success") deliver(escape("kept text"));
            else for (const callback of Array.from(timers.values())) callback();
            assert.equal(completions, 0);
            assert.equal(page.exporter.numPendingOperations, 1);
            assert.equal(timers.size, 0);
            const settled = JSON.stringify(data);
            deliver(escape("ignored replacement"));
            assert.equal(JSON.stringify(data), settled);
            assert.equal(page.exporter.numPendingOperations, 1);
            if (page.exporter.completedOperation(other)) completions++;
            deliver(escape("also ignored"));
            assert.equal(completions, 1);
            assert.equal(JSON.stringify(data), settled);
        } finally {
            page.stop();
        }
    });
}

for (const entry of [
    { field: "notes", blob: escape("Source text"), expected: "Source text" },
    { field: "gmnotes", blob: "", expected: "" },
    { field: "defaulttoken", blob: JSON.stringify({ bar1_value: "12", sides: "first%20side|second" }),
        expected: { bar1_value: "12", sides: ["first side", "second"] } },
]) {
    test(`B016 successful ${entry.field} remains unchanged and clears its timeout`, () => {
        const page = createExporter();
        const timers = new Set();
        page.sandbox.setTimeout = (callback) => { timers.add(callback); return callback; };
        page.sandbox.clearTimeout = (callback) => timers.delete(callback);
        const data = {};
        let completions = 0;
        try {
            const operation = page.exporter.newPendingOperation("successful read");
            page.exporter.getLatestBlob({ id: "successful-document", _getLatestBlob(field, callback) { callback(entry.blob); } },
                entry.field, data, operation, () => completions++);
            assert.deepEqual(JSON.parse(JSON.stringify(data[entry.field])), entry.expected);
            assert.equal(completions, 1);
            assert.equal(timers.size, 0);
            assert.equal(page.exporter.report.documentReadFailures.length, 0);
        } finally {
            page.stop();
        }
    });
}

for (const kind of ["character", "handout"]) {
    test(`B016 permission-hidden ${kind} fields are not acquisition failures`, () => {
        const fixture = options({ is_gm: false });
        const source = kind === "character" ? fixture.campaign.characters.models[0] : fixture.campaign.handouts.models[0];
        const original = source.toJSON;
        source.toJSON = () => Object.assign(original(), { inplayerjournals: "", controlledby: "" });
        let reads = 0;
        source._getLatestBlob = () => { reads++; throw new Error("must not read private content"); };
        const page = createExporter(fixture);
        try {
            const data = kind === "character" ? page.exporter.parseCharacter(source, () => {}) : page.exporter.parseHandout(source, () => {});
            assert.equal(data.gmnotes, "");
            assert.equal(data[kind === "character" ? "bio" : "notes"], "");
            assert.equal(reads, 0);
            assert.equal(page.exporter.report.documentReadFailures.length, 0);
        } finally {
            page.stop();
        }
    });
}

test("B016 a failed JSON attempt can be retried successfully", async () => {
    const fixture = options();
    const source = fixture.campaign.characters.models[0];
    const original = source._getLatestBlob;
    source._getLatestBlob = (field, callback) => {
        if (field === "bio") throw new Error("temporary read failure");
        original(field, callback);
    };
    const page = createExporter(fixture);
    const schedule = page.sandbox.setTimeout;
    page.sandbox.setTimeout = (callback, ms) => schedule(callback, [2000, 10000].includes(ms) ? 5 : ms);
    try {
        page.exporter.exportCampaignJson();
        await waitFor(() => page.exporter.console.closeShown, { label: "first attempt refusal", timeout: 5000 });
        assert.equal(page.recorder.saved.length, 0);
        assert.equal(page.exporter.report.documentReadFailures.length, 1);
        source._getLatestBlob = original;
        page.exporter.exportCampaignJson();
        await waitFor(() => page.recorder.saved.length === 1, { label: "successful retry", timeout: 5000 });
        assert.equal(page.exporter.report.documentReadFailures.length, 0);
        const campaign = JSON.parse(await page.recorder.saved[0].file.text());
        let expected;
        original("bio", blob => { expected = unescape(blob); });
        assert.equal(campaign.characters.find(character => character.id === source.id).bio, expected);
    } finally {
        page.stop();
    }
});

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
        "src/R20Archive.js",
        "src/R20ExportManifests.js",
        "src/R20Exporter.js",
    ]);
    assert.equal(manifest.web_accessible_resources, undefined, "nothing needs to be web-accessible any more");
    for (const file of script.js) {
        assert.ok(fs.existsSync(path.join(__dirname, "..", file)), file + " is listed in the manifest but not shipped");
    }
});
