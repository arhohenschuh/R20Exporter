"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createExporter, waitFor, readZip } = require("./harness/roll20.js");
const { buildCampaign, buildRoutes } = require("./fixtures/campaign.js");

function options(overrides = {}) {
    const { Campaign, Jukebox } = buildCampaign();
    return Object.assign({ campaign: Campaign, jukebox: Jukebox, routes: buildRoutes(), title: "Sunless Citadel" }, overrides);
}

function collectingStream(sink) {
    return new WritableStream({
        write(chunk) {
            sink.chunks.push(chunk);
        },
        close() {
            sink.closed = true;
        },
    });
}

test("a save location chosen up front is streamed to, with no download", async () => {
    const sink = { chunks: [], closed: false };
    let pickedDuringClick = false;
    const handle = { createWritable: async () => collectingStream(sink) };

    const page = createExporter(options({
        showSaveFilePicker: async (opts) => {
            // The picker needs the click's user gesture; by the time a multi-GB
            // zip is ready the gesture is long gone.
            pickedDuringClick = page.exporter.campaign.characters === undefined;
            assert.equal(opts.suggestedName, "Sunless Citadel.zip");
            return handle;
        },
    }));

    await page.exporter.exportCampaignZip();
    await waitFor(() => sink.closed, { label: "the zip stream to close" });
    page.stop();

    assert.equal(pickedDuringClick, true, "the picker must be opened before the campaign is parsed");
    assert.equal(page.recorder.saved.length, 0, "a chosen save location must not also trigger a download");
    assert.ok(sink.chunks.length > 0, "the archive must be streamed, not buffered whole");

    const contents = await readZip(page.sandbox, new Blob(sink.chunks));
    assert.ok(contents["campaign.json"], "the streamed archive must be a readable zip");
    assert.ok(contents["export_report.json"]);
});

test("a cancelled picker falls back to a download instead of failing the export", async () => {
    const page = createExporter(options({
        showSaveFilePicker: async () => {
            throw new DOMException("The user aborted a request.", "AbortError");
        },
    }));
    await page.exporter.exportCampaignZip();
    await waitFor(() => page.recorder.saved.length > 0, { label: "the zip to be saved" });
    const contents = await readZip(page.sandbox, page.recorder.saved[0].file);
    page.stop();
    assert.ok(contents["campaign.json"]);
});

test("without a picker the zip goes through OPFS, not a 4 GB temporary quota", async () => {
    const sink = { chunks: [], closed: false };
    const removed = [];
    let requestedName = null;
    const navigator = {
        hardwareConcurrency: 4,
        storage: {
            getDirectory: async () => ({
                getFileHandle: async (name, opts) => {
                    requestedName = name;
                    assert.equal(opts.create, true);
                    return {
                        createWritable: async () => collectingStream(sink),
                        getFile: async () => new Blob(sink.chunks, { type: "application/zip" }),
                    };
                },
                removeEntry: async (name) => removed.push(name),
            }),
        },
    };

    const page = createExporter(options({ navigator }));
    await page.exporter.exportCampaignZip();
    await waitFor(() => page.recorder.saved.length > 0, { label: "the zip to be saved" });
    page.stop();

    assert.equal(requestedName, "R20Exporter-tmp.zip");
    assert.equal(sink.closed, true);
    assert.equal(page.sandbox.webkitRequestFileSystem, undefined, "the deprecated filesystem API must be gone");
    const contents = await readZip(page.sandbox, page.recorder.saved[0].file);
    assert.ok(contents["campaign.json"]);
    assert.ok(contents["index.json"]);
});

test("a failing destination is reported instead of hanging the export", async () => {
    const errors = [];
    const page = createExporter(options({
        navigator: {
            hardwareConcurrency: 4,
            storage: {
                getDirectory: async () => {
                    throw new DOMException("QuotaExceededError", "QuotaExceededError");
                },
            },
        },
    }));
    page.exporter.console.error = (...args) => errors.push(args.map(String).join(" "));

    await page.exporter.exportCampaignZip();
    await waitFor(() => errors.some((e) => e.includes("Error writing the zip file")), { label: "the write failure to be reported" });
    page.stop();

    assert.ok(errors.some((e) => e.includes("Quota")), "a quota failure must name the cause");
    assert.equal(page.recorder.saved.length, 0);
});
