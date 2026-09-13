"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { parseArgs } = require("node:util");

const hash = buffer => crypto.createHash("sha256").update(buffer).digest("hex");

async function verifyZip(file, extension) {
    const zip = require(path.join(extension, "libs/zipjs/zip-fs.js"));
    zip.configure({ useWebWorkers: false });
    const bytes = fs.readFileSync(file);
    const reader = new zip.ZipReader(new zip.Uint8ArrayReader(bytes));
    try {
        const entries = await reader.getEntries();
        const members = new Map(entries.filter(entry => !entry.directory).map(entry => [entry.filename, entry]));
        assert.equal(members.size, entries.filter(entry => !entry.directory).length, "duplicate ZIP members");
        const read = async name => {
            assert.ok(members.has(name), "missing ZIP member: " + name);
            const entry = members.get(name);
            assert.ok(entry.uncompressedSize <= 512 * 1024 * 1024, "oversized ZIP member");
            return Buffer.from(await entry.getData(new zip.Uint8ArrayWriter()));
        };
        const manifest = JSON.parse(await read("compendium.json"));
        const report = JSON.parse(await read("export_report.json"));
        assert.equal(manifest.R20Compendium_format, "1.0");
        assert.equal(manifest.exporter_version, JSON.parse(fs.readFileSync(path.join(extension, "manifest.json"))).version);
        assert.equal(report.pages.planned, manifest.pages.length);
        assert.equal(report.pages.captured, manifest.pages.filter(page => page.outcome === "captured").length);
        assert.equal(report.assets.planned, manifest.assets.length);
        assert.equal(report.assets.bundled, manifest.assets.filter(asset => asset.outcome === "bundled").length);
        for (const alias of manifest.requestAliases || []) {
            const canonical = manifest.pages.find(page => page.requestUrl === alias.canonicalRequestUrl);
            assert.ok(canonical && canonical.outcome === "captured", "unresolved page alias");
            assert.equal(alias.pageId, canonical.pageId);
            assert.equal(alias.expansion, manifest.source.expansion);
        }
        if (report.discovery) {
            assert.equal(report.discovery.aliases, manifest.requestAliases.length);
            assert.equal(report.discovery.pageRequests, manifest.pages.length + manifest.requestAliases.length);
        }
        assert.ok(!members.has("campaign.json"));
        assert.ok([...manifest.pages, ...manifest.assets].every(record => record.outcome !== "pending"));
        const expected = new Set(["compendium.json", "export_report.json"]);
        const descriptors = manifest.pages.flatMap(page => {
            if (page.outcome === "captured") assert.equal(page.expansion, manifest.source.expansion);
            return page.files || [];
        }).concat(manifest.assets.filter(asset => asset.outcome === "bundled"));
        for (const descriptor of descriptors) {
            assert.ok(!descriptor.path.startsWith("/") && !descriptor.path.split("/").includes(".."));
            expected.add(descriptor.path);
            const body = await read(descriptor.path);
            assert.equal(body.length, descriptor.bytes);
            assert.equal(hash(body), descriptor.sha256);
            if (!descriptor.path.startsWith("assets/")) {
                assert.doesNotMatch(body.toString("utf8"), /PRIVATE_ACCOUNT_SENTINEL|PRIVATE_TOKEN_SENTINEL|d20_account_id|d20_player_id/);
            }
        }
        assert.deepEqual([...members.keys()].sort(), [...expected].sort(), "unmanifested content in ZIP");
        return { status: "PASS", archive: file, bytes: bytes.length, sha256: hash(bytes),
            members: members.size, capture: report, verifiedDescriptors: descriptors.length };
    } finally {
        await reader.close();
        zip.terminateWorkers();
    }
}

async function browserAcceptance(options) {
    const { chromium } = require(path.resolve(options.playwright));
    const extension = path.resolve(options.extension);
    const out = path.resolve(options.out);
    assert.ok(!fs.existsSync(path.join(out, "browser-report.json")), "browser evidence already exists");
    fs.mkdirSync(out, { recursive: true });
    const profile = path.join(out, "disposable-profile");
    assert.ok(!fs.existsSync(profile), "browser profile must be fresh");
    const context = await chromium.launchPersistentContext(profile, {
        executablePath: path.resolve(options.browser), headless: false,
        ignoreDefaultArgs: ["--disable-extensions"],
        args: ["--disable-extensions-except=" + extension, "--load-extension=" + extension],
        viewport: { width: 1366, height: 900 }, acceptDownloads: true,
    });
    try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        const worlds = new Map();
        cdp.on("Runtime.executionContextCreated", event => worlds.set(event.context.id, event.context));
        cdp.on("Runtime.executionContextDestroyed", event => worlds.delete(event.executionContextId));
        cdp.on("Runtime.executionContextsCleared", () => worlds.clear());
        await cdp.send("Runtime.enable");
        const image = await page.evaluate(() => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 4;
            const painter = canvas.getContext("2d");
            painter.fillStyle = "#286549";
            painter.fillRect(0, 0, 4, 4);
            return canvas.toDataURL("image/png").split(",")[1];
        });
        const imageBytes = Buffer.from(image, "base64");
        const requests = [];
        let holdEntry = false;
        let releaseEntry;
        let entryStarted;
        let heldEntry;
        const html = (entry, catalogue) => `<!doctype html><html><head><title>Compendium Test</title><style>
            body{margin:24px;font-family:Georgia,serif;color:#243631}#mainContent{max-width:1000px;margin:auto}
            .toccol{display:none}h1{font-size:28px}*{box-sizing:border-box}</style></head><body>
            <nav>PRIVATE_ACCOUNT_SENTINEL</nav><main id="mainContent"><div class="toccol"><img src="https://files.d20.io/images/test.png"></div>
            <div class="content-text" data-expansionid="4962"><h1>${entry ? "Example Item" : catalogue ? "Bestiary" : "Example King's Book"}</h1>
            <div class="page-header-source">Source: <a href="/compendium/dnd5e/Example King's Book">Example King's Book</a></div>
            <div id="pagecontent" data-pageid="${entry ? "456" : catalogue ? "789" : "123"}">${entry ? '<div id="pagecontent"><p>Original entry text.</p></div>' : catalogue ? '<h3>Items</h3><a href="/compendium/dnd5e/Example%20Item?expansion=4962">Example Item</a>' : '<h3>Appendices</h3><a href="https://roll20.net/compendium/dnd5e/Rules:Bestiary?expansion=4962">Bestiary</a>'}</div>
            <div id="pageAttrs">${entry ? '<div class="attrListItem"><span class="attrName"> Damage </span><span class="attrValue"> 1d6 </span></div>' : ""}</div>
            </div>${catalogue ? '<div class="content-text page-links"><a href="https://roll20.net/compendium/dnd5e/Rules:Example%20King%27s%20Book?expansion=4962" title="Example King\'s Book">Previous Page</a></div>' : ""}</main><script>const privateToken="PRIVATE_TOKEN_SENTINEL";</script></body></html>`;
        await context.route("https://app.roll20.net/compendium/**", async route => {
            requests.push(route.request().url());
            const entry = route.request().url().includes("Example%20Item");
            const catalogue = route.request().url().includes("Rules:Bestiary");
            if (entry && holdEntry) {
                entryStarted();
                await heldEntry;
            }
            await route.fulfill({ status: 200, contentType: "text/html", body: html(entry, catalogue) }).catch(error => {
                if (!holdEntry) throw error;
            });
        });
        await context.route("https://files.d20.io/**", async route => {
            requests.push(route.request().url());
            await route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: imageBytes });
        });
        await page.goto("https://app.roll20.net/compendium/dnd5e/Example%20King%27s%20Book#content");
        await page.locator("#r20compendium-export").waitFor({ state: "visible", timeout: 15000 });
        assert.equal(await page.evaluate(() => typeof globalThis.R20Compendium_instance), "undefined", "collector leaked into page MAIN world");
        let isolated;
        for (const world of worlds.values()) {
            if (world.auxData?.isDefault) continue;
            const probe = await cdp.send("Runtime.evaluate", { contextId: world.id, expression: "!!globalThis.R20Compendium_instance", returnByValue: true });
            if (probe.result.value) isolated = world;
        }
        assert.ok(isolated, "extension isolated world not found");
        const initialRequests = requests.length;
        assert.equal(requests.filter(url => url.includes("Example%20Item")).length, 0, "capture started without user action");
        const downloadReady = page.waitForEvent("download", { timeout: 30000 });
        const capture = await cdp.send("Runtime.evaluate", { contextId: isolated.id,
            expression: "globalThis.R20Compendium_instance.exportZip({usePicker:false}).then(result => result.report)",
            awaitPromise: true, returnByValue: true,
        });
        assert.ok(!capture.exceptionDetails, "isolated export threw");
        assert.equal(capture.result.value.status, "complete-within-index");
        const archive = path.join(out, "synthetic-compendium.zip");
        await (await downloadReady).saveAs(archive);
        const verified = await verifyZip(archive, extension);
        assert.equal(verified.capture.pages.captured, 3);
        assert.equal(verified.capture.assets.bundled, 1);
        assert.equal(verified.capture.discovery.pageRequests, 4);
        assert.equal(verified.capture.discovery.aliases, 1);
        assert.equal(verified.capture.source.title, "Example King's Book");
        assert.match(verified.capture.source.indexUrl, /King%27s/);
        const layouts = [];
        for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            const layout = await page.locator("#r20compendium-toolbar").evaluate(toolbar => {
                const bounds = toolbar.getBoundingClientRect();
                const buttons = Array.from(toolbar.querySelectorAll("button")).filter(button => !button.hidden).map(button => {
                    const rect = button.getBoundingClientRect();
                    return { text: button.textContent, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
                        fits: button.scrollWidth <= button.clientWidth + 1 };
                });
                return { left: bounds.left, right: bounds.right, viewportWidth: innerWidth, buttons };
            });
            assert.ok(layout.left >= 0 && layout.right <= viewport.width, "toolbar exceeds viewport");
            assert.ok(layout.buttons.every(button => button.fits && button.x >= layout.left && button.right <= layout.right), "button clipping");
            for (let first = 0; first < layout.buttons.length; first++) {
                for (let second = first + 1; second < layout.buttons.length; second++) {
                    const left = layout.buttons[first], right = layout.buttons[second];
                    assert.ok(Math.min(left.right, right.right) <= Math.max(left.x, right.x) ||
                        Math.min(left.bottom, right.bottom) <= Math.max(left.y, right.y), "buttons overlap");
                }
            }
            const screenshot = path.join(out, "toolbar-" + viewport.width + ".png");
            const pixels = await page.locator("#r20compendium-toolbar").screenshot({ path: screenshot });
            const colorCount = await page.evaluate(async encoded => {
                const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
                const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
                const canvas = new OffscreenCanvas(image.width, image.height);
                const painter = canvas.getContext("2d");
                painter.drawImage(image, 0, 0);
                image.close();
                const data = painter.getImageData(0, 0, canvas.width, canvas.height).data;
                const colors = new Set();
                for (let offset = 0; offset < data.length; offset += 4) colors.add(data[offset] * 65536 + data[offset + 1] * 256 + data[offset + 2]);
                return colors.size;
            }, pixels.toString("base64"));
            assert.ok(colorCount > 8, "toolbar screenshot is blank");
            layouts.push({ viewport, ...layout, screenshot, distinctColors: colorCount });
        }
        const assetRequestsBeforeCancel = requests.filter(url => url.startsWith("https://files.d20.io/")).length;
        holdEntry = true;
        const started = new Promise(resolve => { entryStarted = resolve; });
        heldEntry = new Promise(resolve => { releaseEntry = resolve; });
        await cdp.send("Runtime.evaluate", { contextId: isolated.id,
            expression: "void globalThis.R20Compendium_instance.exportZip({usePicker:false})" });
        await started;
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        releaseEntry();
        await page.locator('#r20compendium-toolbar[data-state="cancelled"]').waitFor({ timeout: 10000 });
        assert.equal(requests.filter(url => url.startsWith("https://files.d20.io/")).length, assetRequestsBeforeCancel);
        const version = JSON.parse(fs.readFileSync(path.join(extension, "manifest.json"))).version;
        const report = { status: "PASS", version, extension, browser: context.browser()?.version(),
            isolatedWorld: { name: isolated.name, origin: isolated.origin }, mainWorldCollector: "undefined",
            initialRequests, verified, layouts, cancellation: "PASS", networkRequests: requests };
        fs.writeFileSync(path.join(out, "browser-report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
        return report;
    } finally {
        await context.close();
        fs.rmSync(profile, { recursive: true, force: true });
    }
}

async function main() {
    const { values } = parseArgs({ options: {
        extension: { type: "string" }, playwright: { type: "string" }, browser: { type: "string" },
        out: { type: "string" }, "verify-zip": { type: "string" },
    } });
    assert.ok(values.extension, "--extension is required");
    const report = values["verify-zip"]
        ? await verifyZip(path.resolve(values["verify-zip"]), path.resolve(values.extension))
        : await browserAcceptance(values);
    if (values["verify-zip"] && values.out) fs.writeFileSync(values.out, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(report));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { verifyZip, browserAcceptance };