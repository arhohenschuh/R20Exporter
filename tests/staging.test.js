"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createExporter, waitFor, readZip } = require("./harness/roll20.js");
const { createOpfs } = require("./harness/opfs.js");
const { buildCampaign, buildRoutes, collection, model, IMG } = require("./fixtures/campaign.js");

const STAGING_PREFIX = "R20Exporter-staging-";

function options(overrides = {}) {
    const { Campaign, Jukebox } = buildCampaign();
    return Object.assign({ campaign: Campaign, jukebox: Jukebox, routes: buildRoutes(), title: "Sunless Citadel" }, overrides);
}

function captureConsole(page) {
    const errors = [];
    const warnings = [];
    page.exporter.console.error = (...args) => errors.push(args.map(String).join(" "));
    page.exporter.console.warn = (...args) => warnings.push(args.map(String).join(" "));
    return { errors, warnings };
}

// The fixture plants a dead asset, which is reported as an error on purpose.
function writeFailures(consoleLog) {
    return consoleLog.errors.filter((e) => e.includes("Error writing the zip file"));
}

// B012: a Blob that was readable when it arrived and is unreadable once the
// ZIP is written, which is what the failed DotMM run measured on 8,812 members.
function expiringBlobClass(state) {
    const NativeBlob = Blob;
    const unreadable = () => new DOMException(
        "The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.",
        "NotReadableError");
    class AcquiredBlob extends NativeBlob {
        constructor(parts, init, acquired = !state.finalizing) {
            super(parts, init);
            this.acquired = acquired;
            if (acquired) state.acquired.push(this);
        }

        get expired() {
            return this.acquired && state.finalizing;
        }

        arrayBuffer() {
            return this.expired ? Promise.reject(unreadable()) : super.arrayBuffer();
        }

        text() {
            return this.expired ? Promise.reject(unreadable()) : super.text();
        }

        stream() {
            if (this.expired) throw unreadable();
            return super.stream();
        }

        slice(start, end, type) {
            return new AcquiredBlob([super.slice(start, end, type)], { type: type || this.type }, this.acquired);
        }
    }
    return AcquiredBlob;
}

function expiringRoutes(AcquiredBlob) {
    const base = buildRoutes();
    return (url) => {
        const route = base(url);
        if (!route || route instanceof Error || (route.status !== undefined && route.status !== 200)) return route;
        return Object.assign({}, route, {
            blob: new AcquiredBlob([route.body || "data"], { type: route.type || "image/png" }),
        });
    };
}

function onFinalization(page, action) {
    const open = page.exporter._openZipDestination.bind(page.exporter);
    page.exporter._openZipDestination = async (filename) => {
        await action();
        return open(filename);
    };
}

function stagingDirectories(opfs) {
    return Array.from(opfs.root.children.keys()).filter((name) => name.startsWith(STAGING_PREFIX));
}

async function exportAndSettle(page, consoleLog) {
    await page.exporter.exportCampaignZip(null, { usePicker: false });
    await waitFor(() => page.recorder.saved.length > 0 || consoleLog.errors.some((e) => e.includes("Error writing the zip file")),
        { label: "the export to finish", timeout: 20000 });
}

test("B012 members unreadable at finalization are written from bytes staged on arrival", async () => {
    const state = { finalizing: false, acquired: [] };
    const AcquiredBlob = expiringBlobClass(state);
    const opfs = createOpfs();
    const page = createExporter(options({ navigator: opfs.navigator, routes: expiringRoutes(AcquiredBlob) }));
    page.sandbox.Blob = AcquiredBlob;
    const consoleLog = captureConsole(page);
    onFinalization(page, () => {
        state.finalizing = true;
    });

    await exportAndSettle(page, consoleLog);
    await waitFor(() => stagingDirectories(opfs).length === 0, { label: "the staging directory to be removed" });
    page.stop();

    assert.deepEqual(writeFailures(consoleLog), []);
    assert.ok(state.acquired.length > 20, "the campaign members and assets must all have been acquired as Blobs");
    await assert.rejects(state.acquired[0].arrayBuffer(), { name: "NotReadableError" },
        "the control is vacuous unless the acquired Blobs really are unreadable at finalization");

    const contents = await readZip(page.sandbox, page.recorder.saved[0].file);
    assert.ok(JSON.parse(contents["campaign.json"]).characters.length > 0);
    const report = JSON.parse(contents["export_report.json"]);
    assert.ok(contents["integrity.json"] && contents["index.json"]);
    assert.deepEqual(report.notes.filter((note) => note.includes("B012")), []);
    const bundled = report.assets.filter((asset) => asset.outcome !== "failed" && asset.outcome !== "skipped");
    assert.ok(bundled.length > 5);
    for (const asset of bundled) {
        assert.ok(contents[asset.path] !== undefined, "missing " + asset.path);
        assert.equal(contents[asset.path].length, asset.bytes);
        assert.equal(crypto.createHash("sha256").update(contents[asset.path], "utf8").digest("hex"), asset.sha256,
            asset.path + " must hold the bytes that were hashed on arrival");
    }
});

test("B012 a staged member that cannot be reopened fails the export and names the member", async () => {
    const opfs = createOpfs();
    const page = createExporter(options({ navigator: opfs.navigator }));
    const consoleLog = captureConsole(page);
    let removed = 0;
    onFinalization(page, async () => {
        for (const name of stagingDirectories(opfs)) {
            await opfs.root.removeEntry(name, { recursive: true });
            removed += 1;
        }
    });

    await exportAndSettle(page, consoleLog);
    await waitFor(() => !opfs.root.children.has("R20Exporter-tmp.zip"), { label: "the partial ZIP to be discarded" });
    page.stop();

    assert.equal(removed, 1, "the export must have staged its members in exactly one directory");
    assert.equal(page.recorder.saved.length, 0, "an archive missing a member must not be delivered");
    const failure = consoleLog.errors.find((e) => e.includes("Error writing the zip file"));
    assert.match(failure, /campaign\.json/, "the failure must name the member that could not be read");
    assert.match(failure, /NotFoundError/);
});

test("B012 without a staging store the export still completes and says its members stayed Blobs", async () => {
    const page = createExporter(options({ navigator: { hardwareConcurrency: 4 } }));
    const consoleLog = captureConsole(page);

    await exportAndSettle(page, consoleLog);
    page.stop();

    assert.deepEqual(writeFailures(consoleLog), []);
    const contents = await readZip(page.sandbox, page.recorder.saved[0].file);
    const report = JSON.parse(contents["export_report.json"]);
    const notes = report.notes.filter((note) => note.includes("B012"));
    assert.equal(notes.length, 1, JSON.stringify(report.notes));
    assert.match(notes[0], /retained as browser Blobs/);
    assert.ok(consoleLog.warnings.some((w) => w.includes("staging")), "the degradation must be visible in the dialog");
});

test("B012 a staging write that fails keeps that member as a Blob and is counted", async () => {
    const opfs = createOpfs({
        failCreateWritable: (path) => path.startsWith(STAGING_PREFIX)
            ? new DOMException("The quota has been exceeded.", "QuotaExceededError") : null,
    });
    const page = createExporter(options({ navigator: opfs.navigator }));
    const consoleLog = captureConsole(page);

    await exportAndSettle(page, consoleLog);
    await waitFor(() => stagingDirectories(opfs).length === 0, { label: "the staging directory to be removed" });
    page.stop();

    assert.deepEqual(writeFailures(consoleLog), []);
    const contents = await readZip(page.sandbox, page.recorder.saved[0].file);
    const report = JSON.parse(contents["export_report.json"]);
    const notes = report.notes.filter((note) => note.includes("B012"));
    assert.equal(notes.length, 1, JSON.stringify(report.notes));
    assert.match(notes[0], /QuotaExceededError/);
    assert.match(notes[0], /\d+ ZIP member\(s\) retained as browser Blobs/);
    const bundled = report.assets.filter((asset) => asset.outcome === "bundled");
    for (const asset of bundled) assert.ok(asset.sha256, asset.path + " must still be hashed");
});

test("B012 staging directories abandoned by an earlier run are removed, a live one is not", async () => {
    const opfs = createOpfs();
    const abandoned = STAGING_PREFIX + "1000-abandoned";
    const live = STAGING_PREFIX + Date.now() + "-othertab";
    await (await opfs.root.getDirectoryHandle(abandoned, { create: true })).getFileHandle("0", { create: true });
    await (await opfs.root.getDirectoryHandle(live, { create: true })).getFileHandle("0", { create: true });
    const page = createExporter(options({ navigator: opfs.navigator }));
    const consoleLog = captureConsole(page);

    await exportAndSettle(page, consoleLog);
    await waitFor(() => stagingDirectories(opfs).length === 1, { label: "this run's staging directory to be removed" });
    page.stop();

    assert.deepEqual(writeFailures(consoleLog), []);
    assert.deepEqual(stagingDirectories(opfs), [live]);
});

test("B017 an asset whose last canvas candidate fails validation does not stall the export", async () => {
    const DEGENERATE = IMG + "/degenerate/med.png?42";
    const { Campaign, Jukebox } = buildCampaign();
    Campaign.decks = collection([
        model({ id: "deck-1", name: "Fate", avatar: DEGENERATE, currentDeck: "", discardPile: "" }, {
            cards: collection([model({ id: "card-1", name: "Ace", avatar: "" })]),
        }),
    ]);
    const page = createExporter(options({
        campaign: Campaign,
        jukebox: Jukebox,
        // A 0 x 0 graphic: every HTTP body decodes to no pixels, and so does the
        // canvas fallback, whose toBlob() then yields null.
        createImageBitmap: async (blob) => {
            const degenerate = (await blob.text()).includes("/degenerate/");
            return { width: degenerate ? 0 : 1, height: degenerate ? 0 : 1, close() {} };
        },
    }));
    page.sandbox.Image = class DegenerateImage {
        set src(value) {
            this._src = value;
            if (!value) return;
            page.sandbox.setTimeout(() => {
                if (value.includes("/degenerate/")) {
                    this.naturalWidth = 0;
                    this.naturalHeight = 0;
                    if (this.onload) this.onload();
                } else if (this.onerror) {
                    this.onerror(new Error("no image decoder in the harness"));
                }
            }, 0);
        }

        get src() {
            return this._src;
        }
    };
    page.sandbox.document.createElement = () => ({
        width: 0,
        height: 0,
        style: {},
        getContext: () => ({ drawImage() {} }),
        toBlob: (callback) => page.sandbox.setTimeout(() => callback(null), 0),
    });
    const consoleLog = captureConsole(page);

    await exportAndSettle(page, consoleLog);
    page.stop();

    assert.deepEqual(writeFailures(consoleLog), []);
    const contents = await readZip(page.sandbox, page.recorder.saved[0].file);
    const report = JSON.parse(contents["export_report.json"]);
    const avatar = report.assets.find((asset) => asset.url === DEGENERATE);
    assert.equal(avatar.outcome, "failed");
    assert.match(avatar.reason, /canvas/);
    assert.ok(avatar.attempts.some((attempt) => /empty/.test(attempt.error || "")),
        "the canvas candidate must have reached validation, which is the path that used to stall");
    assert.equal(report.totals.pending, 0);
});

test("B017 every save step runs exactly once while operations end out of order", async () => {
    const page = createExporter(options());
    const consoleLog = captureConsole(page);
    const calls = {};
    for (const name of ["_saveCampaignZipCharacters", "_saveCampaignZipJournal", "_saveCampaignZipPages",
        "_saveCampaignZipPage", "_saveCampaignZipJukebox", "_saveCampaignZipDecks", "_saveCampaignZipTables",
        "_saveCampaignZipManifests", "_saveZipToFile"]) {
        const original = page.exporter[name].bind(page.exporter);
        calls[name] = 0;
        page.exporter[name] = (...args) => {
            calls[name] += 1;
            return original(...args);
        };
    }

    await exportAndSettle(page, consoleLog);
    await new Promise((resolve) => setTimeout(resolve, 50));
    page.stop();

    assert.deepEqual(writeFailures(consoleLog), []);
    const pages = page.exporter.campaign.pages.length;
    assert.deepEqual(calls, {
        _saveCampaignZipCharacters: 1,
        _saveCampaignZipJournal: 1,
        _saveCampaignZipPages: 1,
        _saveCampaignZipPage: pages + 1,
        _saveCampaignZipJukebox: 1,
        _saveCampaignZipDecks: 1,
        _saveCampaignZipTables: 1,
        _saveCampaignZipManifests: 1,
        _saveZipToFile: 1,
    });
});

test("B012 a ZIP that cannot start leaves nothing pending, so the next export in the tab completes", async () => {
    const opfs = createOpfs();
    const page = createExporter(options({ navigator: opfs.navigator }));
    const consoleLog = captureConsole(page);
    const jsonToBlob = page.exporter.jsonToBlob.bind(page.exporter);
    let fail = true;
    page.exporter.jsonToBlob = (value) => {
        if (fail && value === page.exporter.campaign) {
            fail = false;
            throw new RangeError("Invalid string length");
        }
        return jsonToBlob(value);
    };

    await page.exporter.exportCampaignZip(null, { usePicker: false });
    await waitFor(() => consoleLog.errors.some((e) => e.includes("Could not start writing the ZIP file")),
        { label: "the start failure to be reported" });
    await waitFor(() => stagingDirectories(opfs).length === 0, { label: "the failed start's staging directory to be removed" });
    assert.equal(page.exporter.numPendingOperations, 0, "a failed start must not leave an operation open");
    assert.match(consoleLog.errors.find((e) => e.includes("Could not start")), /RangeError: Invalid string length/);

    await page.exporter.exportCampaignZip(null, { usePicker: false });
    await waitFor(() => page.recorder.saved.length > 0, { label: "the retried export", timeout: 20000 });
    page.stop();
    const contents = await readZip(page.sandbox, page.recorder.saved[0].file);
    assert.ok(JSON.parse(contents["campaign.json"]).characters.length > 0);
});