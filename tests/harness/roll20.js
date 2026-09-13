"use strict";

// A synthetic Roll20 page, good enough to run the real src/R20Exporter.js.
//
// ADR-002: the exporter only ever runs inside Roll20, so the only honest way to
// test it offline is to reproduce the page contract rather than to refactor the
// exporter into something a test can import.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "..", "src");
const LIBS = path.join(__dirname, "..", "..", "libs");

// --- jQuery, reduced to what the exporter actually calls ---------------------

function makeStub(elements = []) {
    const stub = {
        length: elements.length,
        find: () => makeStub(),
        filter: () => makeStub(elements),
        append: () => stub,
        html: () => stub,
        css: () => stub,
        text: () => stub._text || "",
        remove: () => stub,
        show: () => stub,
        hide: () => stub,
        click: () => stub,
        on: () => stub,
        tooltip: () => stub,
    };
    for (let i = 0; i < elements.length; i++) stub[i] = elements[i];
    return stub;
}

const SCRIPT_RE = /<script[^>]*>([\s\S]*?)<\/script>/g;

function makeJQuery(options) {
    const $ = (selector) => {
        if (typeof selector === "string" && selector.includes("<script")) {
            const scripts = [];
            let match;
            SCRIPT_RE.lastIndex = 0;
            while ((match = SCRIPT_RE.exec(selector)) !== null) {
                scripts.push({ textContent: match[1] });
            }
            return makeStub(scripts);
        }
        if (selector === "head title") {
            const stub = makeStub([{}]);
            stub._text = options.title + " | Roll20";
            return stub;
        }
        return makeStub();
    };
    $.post = () => ({ fail: () => undefined });
    return $;
}

// --- the page ---------------------------------------------------------------

function makeFetch(routes, log) {
    return (url) => {
        log.push(url);
        const route = typeof routes === "function" ? routes(url) : routes[url];
        if (route === undefined) {
            return Promise.resolve({ status: 404, statusText: "Not Found", blob: () => Promise.resolve(new Blob([""])) });
        }
        if (route instanceof Error) return Promise.reject(route);
        const status = route.status === undefined ? 200 : route.status;
        return Promise.resolve({
            status: status,
            statusText: route.statusText || (status === 200 ? "OK" : "Error"),
            blob: () => Promise.resolve(route.blob || new Blob([route.body || "data"], { type: route.type || "image/png" })),
            json: () => Promise.resolve(route.json || {}),
        });
    };
}

function createPage(options = {}) {
    const recorder = { entries: [], closed: false, saved: [], fetched: [] };
    const timers = { timeouts: new Set(), intervals: new Set() };
    const sandbox = {
        console: options.verbose ? console : { log() {}, warn() {}, error() {} },
        setTimeout: (fn, ms) => {
            const id = setTimeout(() => { timers.timeouts.delete(id); fn(); }, ms);
            timers.timeouts.add(id);
            return id;
        },
        clearTimeout: (id) => { timers.timeouts.delete(id); clearTimeout(id); },
        setInterval: (fn, ms) => {
            const id = setInterval(fn, ms);
            timers.intervals.add(id);
            return id;
        },
        clearInterval: (id) => { timers.intervals.delete(id); clearInterval(id); },
        Promise,
        Math,
        JSON,
        Date,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Error,
        Map,
        Set,
        RegExp,
        Buffer,
        Uint8Array,
        Uint16Array,
        Uint32Array,
        Int32Array,
        Float64Array,
        DataView,
        ArrayBuffer,
        SharedArrayBuffer: globalThis.SharedArrayBuffer,
        WebAssembly,
        TextEncoder,
        TextDecoder,
        ReadableStream,
        WritableStream,
        TransformStream,
        CompressionStream: globalThis.CompressionStream,
        DecompressionStream: globalThis.DecompressionStream,
        URL,
        Response: globalThis.Response,
        queueMicrotask,
        structuredClone,
        navigator: options.navigator || { hardwareConcurrency: 4 },
        crypto: globalThis.crypto,
        AbortController,
        atob: (s) => Buffer.from(s, "base64").toString("binary"),
        btoa: (s) => Buffer.from(s, "binary").toString("base64"),
        unescape: global.unescape,
        Blob,
        File,
        createImageBitmap: Object.prototype.hasOwnProperty.call(options, "createImageBitmap")
            ? options.createImageBitmap
            : (async () => ({ width: 1, height: 1, close() {} })),
        FileReader: class {
            readAsText(blob) {
                blob.text().then((text) => {
                    this.result = text;
                    if (this.onload) this.onload();
                }, () => {
                    if (this.onerror) this.onerror();
                });
            }
        },
        // No image decoder here, so the canvas fallback always fails -- which is
        // what a test wants: the failure path, immediately.
        Image: class FakeImage {
            set src(value) {
                this._src = value;
                if (!value) return;
                sandbox.setTimeout(() => {
                    if (this.onerror) this.onerror(new Error("no image decoder in the harness"));
                }, 0);
            }
            get src() {
                return this._src;
            }
        },
        MutationObserver: class {
            observe() {}
            disconnect() {}
        },
        document: {
            createElement: () => ({ getContext: () => null, style: {} }),
            head: null,
            documentElement: null,
        },
        location: { protocol: "https:" },
        is_gm: options.is_gm === undefined ? true : options.is_gm,
        d20_player_id: options.player_id || "player-gm",
        d20_account_id: options.account_id || "account-1",
        campaign_id: options.campaign_id || 12345,
        BackboneFirebase: function BackboneFirebase() {
            this.reference = { once: () => Promise.resolve() };
        },
        Campaign: options.campaign,
        Jukebox: options.jukebox || { playlist: { models: [], toJSON: () => [] } },
        saveAs: (file, filename) => recorder.saved.push({ file, filename }),
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    sandbox.$ = makeJQuery({ title: options.title || "Test Campaign" });
    sandbox.fetch = makeFetch(options.routes || {}, recorder.fetched);
    sandbox.window.addEventListener = () => {};
    if (options.showSaveFilePicker) sandbox.showSaveFilePicker = options.showSaveFilePicker;

    const context = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(LIBS, "zipjs", "zip-fs.js"), "utf8"), context, { filename: "zip-fs.js" });
    // No Worker in Node: keep zip.js on the main thread whatever the exporter asks for.
    sandbox.zip.configure({ useWebWorkers: false });
    const configure = sandbox.zip.configure;
    sandbox.zip.configure = (settings) => configure(Object.assign({}, settings, { useWebWorkers: false }));
    for (const file of ["R20Archive.js", "R20ExportManifests.js", "R20Exporter.js"]) {
        vm.runInContext(fs.readFileSync(path.join(SRC, file), "utf8"), context, { filename: file });
    }
    vm.runInContext("globalThis.__R20Exporter = R20Exporter;", context, { filename: "expose.js" });

    // The exporter arms 10s blob timeouts and 60s hang detectors that outlive a
    // passing test and would keep the event loop alive.
    const stop = () => {
        for (const id of timers.timeouts) clearTimeout(id);
        for (const id of timers.intervals) clearInterval(id);
        timers.timeouts.clear();
        timers.intervals.clear();
    };

    return { sandbox, context, recorder, stop };
}

function createExporter(options = {}) {
    const page = createPage(options);
    const exporter = new page.sandbox.__R20Exporter(options.title || "Test Campaign");
    return Object.assign(page, { exporter });
}

// The exporter is a callback state machine driven by setTimeout; a test waits
// for the saved file rather than for a promise it does not have.
function waitFor(predicate, { timeout = 15000, label = "condition" } = {}) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeout;
        const poll = () => {
            let value;
            try {
                value = predicate();
            } catch (err) {
                return reject(err);
            }
            if (value) return resolve(value);
            if (Date.now() > deadline) return reject(new Error("timed out waiting for " + label));
            setTimeout(poll, 5);
        };
        poll();
    });
}

async function runZipExport(options = {}) {
    const page = createExporter(options);
    await page.exporter.exportCampaignZip();
    await waitFor(() => page.recorder.saved.length > 0, { label: "the zip to be saved" });
    page.contents = await readZip(page.sandbox, page.recorder.saved[0].file);
    return page;
}

// Read the produced archive back with the same library, so a test asserts on a
// real zip rather than on the calls the exporter happened to make.
async function readZip(sandbox, blob) {
    const zipFs = new sandbox.zip.fs.FS();
    await zipFs.importBlob(blob);
    const contents = {};
    const dates = {};
    const walk = async (entry) => {
        for (const child of entry.children) {
            if (child.directory) {
                await walk(child);
            } else {
                contents[child.getFullname()] = await child.getText();
                dates[child.getFullname()] = child.data ? child.data.lastModDate : undefined;
            }
        }
    };
    await walk(zipFs.root);
    Object.defineProperty(contents, "__dates", { value: dates, enumerable: false });
    return contents;
}

module.exports = { createPage, createExporter, runZipExport, waitFor, readZip };
