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

// --- zip.js, reduced to the zip.fs subset the exporter uses ------------------

class FakeZipEntry {
    constructor(name, parent, directory) {
        this.name = name;
        this.parent = parent;
        this.directory = !!directory;
        this.children = directory ? [] : undefined;
        this.data = null;
        this.Reader = FakeReader;
    }

    getFullname() {
        const parts = [];
        let current = this;
        while (current && current.parent) {
            parts.unshift(current.name);
            current = current.parent;
        }
        return parts.join("/");
    }

    addDirectory(name) {
        const entry = new FakeZipEntry(name, this, true);
        this.children.push(entry);
        return entry;
    }

    addBlob(name, blob) {
        const entry = new FakeZipEntry(name, this, false);
        entry.data = blob;
        this.children.push(entry);
        return entry;
    }
}

class FakeReader {
    constructor(data) {
        this.data = data;
    }
}

function makeZip(recorder) {
    return {
        useWebWorkers: false,
        fs: {
            FS: class {
                constructor() {
                    this.root = new FakeZipEntry("", null, true);
                }
            },
        },
        FileWriter: class {
            constructor(fileEntry) {
                this.fileEntry = fileEntry;
            }
        },
        createWriter(writer, onCreated) {
            onCreated({
                add(name, reader, onend, onprogress, options) {
                    recorder.entries.push({
                        name: name,
                        directory: !!(options && options.directory),
                        lastModDate: options ? options.lastModDate : undefined,
                        data: reader ? reader.data : null,
                    });
                    onend({ data: reader ? reader.data : null });
                },
                close(onend) {
                    recorder.closed = true;
                    onend();
                },
            });
        },
    };
}

// --- the page ---------------------------------------------------------------

class FakeBlob {
    constructor(parts, options = {}) {
        this._text = parts.map((p) => (typeof p === "string" ? p : String(p))).join("");
        this.size = Buffer.byteLength(this._text);
        this.type = options.type || "";
    }
    text() {
        return Promise.resolve(this._text);
    }
    arrayBuffer() {
        const buffer = Buffer.from(this._text);
        return Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    }
}

function makeFetch(routes, log) {
    return (url) => {
        log.push(url);
        const route = typeof routes === "function" ? routes(url) : routes[url];
        if (route === undefined) {
            return Promise.resolve({ status: 404, statusText: "Not Found", blob: () => Promise.resolve(new FakeBlob([""])) });
        }
        if (route instanceof Error) return Promise.reject(route);
        const status = route.status === undefined ? 200 : route.status;
        return Promise.resolve({
            status: status,
            statusText: route.statusText || (status === 200 ? "OK" : "Error"),
            blob: () => Promise.resolve(route.blob || new FakeBlob([route.body || "data"], { type: route.type || "image/png" })),
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
        crypto: globalThis.crypto,
        AbortController,
        atob: (s) => Buffer.from(s, "base64").toString("binary"),
        btoa: (s) => Buffer.from(s, "binary").toString("base64"),
        unescape: global.unescape,
        Blob: FakeBlob,
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
    sandbox.zip = makeZip(recorder);
    sandbox.fetch = makeFetch(options.routes || {}, recorder.fetched);
    sandbox.window.addEventListener = () => {};
    sandbox.webkitRequestFileSystem = (type, size, cb) => {
        const fileEntry = {
            remove: (ok) => ok(),
            file: (cb2) => cb2({ name: "tmp.zip", size: 0 }),
        };
        cb({ root: { getFile: (name, opts, ok) => ok(fileEntry) } });
    };

    const context = vm.createContext(sandbox);
    for (const file of ["R20ExportManifests.js", "R20Exporter.js"]) {
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
    page.exporter.exportCampaignZip();
    await waitFor(() => page.recorder.saved.length > 0, { label: "the zip to be saved" });
    return page;
}

function zipContents(recorder) {
    const contents = {};
    for (const entry of recorder.entries) {
        if (entry.directory) continue;
        contents[entry.name] = entry.data ? entry.data._text : "";
    }
    return contents;
}

module.exports = { createPage, createExporter, runZipExport, waitFor, zipContents, FakeBlob };
