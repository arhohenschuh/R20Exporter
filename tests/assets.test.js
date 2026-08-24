"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { hostCandidates, assetCandidates, resolutionOf } = require("../src/R20ExportManifests.js");
const { createExporter, runZipExport } = require("./harness/roll20.js");
const { buildCampaign, buildRoutes, LEGACY_ONLY_ASSET, LEGACY_HOST, DEAD_ASSET } = require("./fixtures/campaign.js");

const MALFORMED_ASSET = "https://files.d20.io/images/map/med.png?5";

async function exportFixture(overrides = {}) {
    const { Campaign, Jukebox } = buildCampaign();
    const page = await runZipExport(Object.assign({
        campaign: Campaign,
        jukebox: Jukebox,
        routes: buildRoutes(),
        title: "Sunless Citadel",
    }, overrides));
    page.stop();
    return page.contents;
}

function malformedMapRoutes({ recover = true } = {}) {
    const fallback = buildRoutes();
    return (url) => {
        const direct = url
            .replace("https://s3.amazonaws.com/files.d20.io/", "https://files.d20.io/")
            .replace("https://files.staging.d20.io/", "https://files.d20.io/");
        if (!direct.includes("/images/map/")) return fallback(url);
        if (recover && direct.includes("/max.")) {
            return { body: "valid-image", type: "image/jpeg" };
        }
        return { body: "malformed-image", type: "image/jpeg" };
    };
}

function truncatedJpegRoutes() {
    const fallback = buildRoutes();
    return (url) => {
        const direct = url
            .replace("https://s3.amazonaws.com/files.d20.io/", "https://files.d20.io/")
            .replace("https://files.staging.d20.io/", "https://files.d20.io/");
        if (!direct.includes("/images/map/")) return fallback(url);
        if (direct.includes("/max.")) {
            return { body: Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]), type: "image/jpeg" };
        }
        return { body: Buffer.from([0xFF, 0xD8, 0x00, 0x01, 0x02]), type: "image/jpeg" };
    };
}

async function rejectMalformedImage(blob) {
    if (await blob.text() === "malformed-image") {
        throw new Error("InvalidStateError: the image source is malformed");
    }
    return { width: 1, height: 1, close() {} };
}

test("a Roll20 asset is spelled for every known CDN host, renamed host first", () => {
    assert.deepEqual(hostCandidates("https://files.d20.io/images/1/med.png"), [
        "https://files.d20.io/images/1/med.png",
        "https://s3.amazonaws.com/files.d20.io/images/1/med.png",
        "https://files.staging.d20.io/images/1/med.png",
    ]);
    // The pre-rename spelling normalises to the same ladder, so an old URL and a
    // new URL for one object are never treated as two different assets.
    assert.deepEqual(
        hostCandidates("https://s3.amazonaws.com/files.d20.io/images/1/med.png"),
        hostCandidates("https://files.d20.io/images/1/med.png")
    );
    assert.deepEqual(hostCandidates("https://example.com/art.png"), ["https://example.com/art.png"]);
});

test("every host is tried at a resolution before dropping to a smaller one", () => {
    const candidates = assetCandidates("https://files.d20.io/images/1/med.png?123");
    assert.equal(candidates.length, 12);
    assert.deepEqual(candidates.slice(0, 4).map((c) => c.variant), ["original", "original", "original", "max"]);
    assert.equal(candidates[0].url, "https://files.d20.io/images/1/original.png?123");
    assert.equal(candidates[1].url, "https://s3.amazonaws.com/files.d20.io/images/1/original.png?123");
    assert.deepEqual([...new Set(candidates.map((c) => c.variant))], ["original", "max", "med", "thumb"]);
});

test("a url with no resolution variant is still tried on every host, once each", () => {
    const candidates = assetCandidates("https://files.d20.io/images/1/avatar.png");
    assert.deepEqual(candidates.map((c) => c.variant), [null, null, null]);
    assert.equal(resolutionOf("https://files.d20.io/images/1/avatar.png"), null);
    assert.equal(resolutionOf("https://files.d20.io/images/1/thumb.jpg?9"), "thumb");
});

test("an asset that only answers on the legacy host is recovered, not lost", async () => {
    const contents = await exportFixture();
    const report = JSON.parse(contents["export_report.json"]);
    const recovered = report.assets.find((a) => a.url === LEGACY_ONLY_ASSET);
    assert.ok(recovered, "the legacy-host asset must be in the report");
    assert.equal(recovered.outcome, "bundled");
    assert.ok(recovered.served_from.startsWith(LEGACY_HOST), "served_from must name the host that actually answered");
    assert.equal(recovered.variant, "original");
    assert.ok(contents[recovered.path] !== undefined, "the recovered bytes must be in the zip");
    assert.equal(report.totals.failed, 1, "only the genuinely dead asset may fail");
});

test("provenance is recorded for every stored asset", async () => {
    const contents = await exportFixture();
    const report = JSON.parse(contents["export_report.json"]);
    const stored = report.assets.filter((a) => a.outcome === "bundled" || a.outcome === "bundled-lower-res");
    assert.ok(stored.length >= 5);
    for (const asset of stored) {
        assert.match(asset.sha256 || "", /^[0-9a-f]{64}$/, asset.path + " has no content hash");
        assert.ok(asset.bytes > 0, asset.path + " has no byte count");
        assert.ok(asset.served_from, asset.path + " does not name the url that served it");
        assert.ok(asset.attempts.length >= 1, asset.path + " records no attempt");
    }
});

test("a candidate that cannot be fetched is abandoned, not retried", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    const page = await runZipExport({ campaign: Campaign, jukebox: Jukebox, routes: buildRoutes(), title: "Sunless Citadel" });
    const requests = page.recorder.fetched.filter((u) => u.startsWith("https://s3.amazonaws.com/"));
    page.stop();

    assert.ok(requests.length > 0, "the legacy host must still be tried once");
    const counts = {};
    for (const url of requests) counts[url] = (counts[url] || 0) + 1;
    const repeated = Object.entries(counts).filter(([, n]) => n > 1);
    // B007: a CORS rejection carries no status, so backoff used to retry it three
    // times per candidate -- twelve candidates of dead time per dead asset.
    assert.deepEqual(repeated, [], "a candidate with somewhere else to go must be asked once");
});

test("a dead asset records every candidate it tried before giving up", async () => {
    const contents = await exportFixture();
    const report = JSON.parse(contents["export_report.json"]);
    const dead = report.assets.find((a) => a.url === DEAD_ASSET);
    assert.equal(dead.outcome, "failed");
    const tried = new Set(dead.attempts.map((a) => a.url));
    assert.equal(tried.size, 12, "all four resolutions on all three hosts must be tried");
    assert.ok([...tried].some((u) => u.includes("s3.amazonaws.com")), "the legacy host must be among them");
    assert.ok([...tried].some((u) => u.includes("/original.")), "the original resolution must be among them");
});

test("a malformed HTTP 200 image falls through to a decodable lower resolution", async () => {
    const contents = await exportFixture({
        routes: malformedMapRoutes(),
        createImageBitmap: rejectMalformedImage,
    });
    const report = JSON.parse(contents["export_report.json"]);
    const asset = report.assets.find((row) => row.url === MALFORMED_ASSET);

    assert.equal(asset.outcome, "bundled-lower-res");
    assert.equal(asset.variant, "max");
    assert.equal(contents[asset.path], "valid-image");
    const rejected = asset.attempts.filter((attempt) => attempt.error && attempt.error.includes("image decode failed"));
    assert.equal(rejected.length, 3, "all three host spellings of the malformed original must be rejected");
});

test("an image with no decodable candidate is failed and omitted from the zip", async () => {
    const contents = await exportFixture({
        routes: malformedMapRoutes({ recover: false }),
        createImageBitmap: rejectMalformedImage,
    });
    const report = JSON.parse(contents["export_report.json"]);
    const asset = report.assets.find((row) => row.url === MALFORMED_ASSET);

    assert.equal(asset.outcome, "failed");
    assert.match(asset.reason, /decode|canvas/i);
    assert.equal(contents[asset.path], undefined, "malformed bytes must never enter the zip");
    assert.ok(asset.attempts.some((attempt) => attempt.error && attempt.error.includes("image decode failed")));
});

test("a JPEG missing EOI is rejected even when the browser decoder is lenient", async () => {
    const contents = await exportFixture({ routes: truncatedJpegRoutes() });
    const report = JSON.parse(contents["export_report.json"]);
    const asset = report.assets.find((row) => row.url === MALFORMED_ASSET);

    assert.equal(asset.outcome, "bundled-lower-res");
    assert.equal(asset.variant, "max");
    assert.equal(
        asset.attempts.filter((attempt) => attempt.error && attempt.error.includes("JPEG EOI marker")).length,
        3
    );
});

test("image validation fails closed when the browser decoder is unavailable", async () => {
    const { Campaign, Jukebox } = buildCampaign();
    const page = createExporter({
        campaign: Campaign,
        jukebox: Jukebox,
        routes: buildRoutes(),
        title: "Sunless Citadel",
        createImageBitmap: undefined,
    });

    await assert.rejects(
        page.exporter._validateImageBlob(new page.sandbox.Blob(["image"], { type: "image/png" })),
        /createImageBitmap is unavailable/
    );
    page.stop();
});
