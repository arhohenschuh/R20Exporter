"use strict";

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./R20Compendium.js"));
    } else {
        const api = factory(root.R20Compendium);
        root.R20Compendium_instance = api.mount(document);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (compendium) {
    const MEMORY_ARCHIVE_LIMIT = 512 * 1024 * 1024;
    const STAGED_ARCHIVE_LIMIT = 4 * 1024 * 1024 * 1024;

    function mount(document, options = {}) {
        if (document.getElementById("r20compendium-toolbar")) return null;
        let source;
        let plan;
        try {
            source = compendium.readCompendiumDocument(document, document.location.href);
            if (!source.isIndex) return null;
            plan = compendium.planCompendiumLinks(document.location.href, source.expansion, compendium.compendiumDiscoveryLinks(source));
            if (!plan.pages.length) return null;
        } catch {
            return null;
        }
        const archive = options.archive || globalThis.R20Archive;
        const createZip = options.createZip || (() => new zip.fs.FS().root);
        const createCollector = options.createCollector || (settings => new compendium.R20CompendiumCollector(settings));
        const save = options.saveAs || globalThis.saveAs;
        const terminateWorkers = options.terminateWorkers || (() => zip.terminateWorkers());
        const picker = options.picker || globalThis.showSaveFilePicker?.bind(globalThis);
        const element = (tag, text, className) => {
            const result = document.createElement(tag);
            if (text) result.textContent = text;
            if (className) result.className = className;
            return result;
        };
        const toolbar = element("section");
        toolbar.id = "r20compendium-toolbar";
        toolbar.setAttribute("aria-label", "R20Exporter compendium export");
        const row = element("div", "", "r20compendium-row");
        const name = element("strong", "R20Exporter");
        const quantity = (count, label) => count + " " + label + (count === 1 ? "" : "s");
        const count = element("span", quantity(plan.pages.length, "index link"), "r20compendium-count");
        const actions = element("div", "", "r20compendium-actions");
        const start = element("button", "Export Compendium");
        const cancel = element("button", "Cancel");
        const reportButton = element("button", "Download report");
        for (const button of [start, cancel, reportButton]) button.type = "button";
        start.id = "r20compendium-export";
        cancel.id = "r20compendium-cancel";
        cancel.hidden = true;
        reportButton.disabled = true;
        const progress = element("progress");
        progress.max = 1;
        progress.value = 0;
        progress.hidden = true;
        progress.setAttribute("aria-label", "Compendium export progress");
        const status = element("p", "Ready", "r20compendium-status");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        actions.append(start, cancel, reportButton);
        row.append(name, count, actions);
        toolbar.append(row, progress, status);
        document.querySelector("#pagecontent").closest("[data-expansionid]")
            .querySelector(".page-header-source").after(toolbar);
        const filename = source.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").slice(0, 100) + "-compendium.zip";
        const state = { running: false, result: null, exportZip, cancel: () => controller?.abort() };
        let controller;

        async function exportZip(settings = {}) {
            if (state.running) return null;
            state.running = true;
            state.result = null;
            controller = new AbortController();
            start.disabled = true;
            cancel.hidden = false;
            cancel.disabled = false;
            reportButton.disabled = true;
            progress.hidden = false;
            status.textContent = "Preparing export";
            toolbar.dataset.state = "running";
            let destination;
            let staging = null;
            try {
                let saveHandle = null;
                if (settings.usePicker !== false && picker) {
                    try {
                        saveHandle = await picker({
                            suggestedName: filename,
                            types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
                        });
                    } catch (error) {
                        if (error.name === "AbortError") controller.abort();
                        else throw error;
                    }
                }
                if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
                const root = createZip();
                const folders = new Map([["", root]]);
                // B018: staged members let a large book exceed the in-memory cap (ADR-008).
                const storage = { mode: "memory", limit: MEMORY_ARCHIVE_LIMIT, unavailable: null };
                if (typeof archive.openStagingStore === "function" && typeof archive.addMember === "function") {
                    try {
                        staging = await archive.openStagingStore();
                        storage.mode = "opfs-staging";
                        storage.limit = STAGED_ARCHIVE_LIMIT;
                    } catch (error) {
                        storage.unavailable = (error && error.name ? error.name + ": " : "") + (error && error.message || String(error));
                    }
                } else {
                    storage.unavailable = "staging is not supported by this archive";
                }
                const store = async (path, blob) => {
                    const parts = path.split("/");
                    const name = parts.pop();
                    let prefix = "";
                    let folder = root;
                    for (const part of parts) {
                        prefix = prefix ? prefix + "/" + part : part;
                        if (!folders.has(prefix)) folders.set(prefix, folder.addDirectory(part));
                        folder = folders.get(prefix);
                    }
                    if (!staging) {
                        folder.addBlob(name, blob);
                        return;
                    }
                    const handle = await staging.persist(await blob.arrayBuffer());
                    const member = archive.addMember(folder, name, blob, path);
                    member.handle = handle;
                    member.blob = null;
                };
                const collector = createCollector({ store, signal: controller.signal, maxArchiveBytes: storage.limit,
                    onProgress: update => {
                        progress.max = Math.max(1, update.total);
                        progress.value = update.completed;
                        if (update.phase === "pages") count.textContent = quantity(update.total, "discovered page");
                        status.textContent = (update.phase === "assets" ? "Images" : "Pages") + ": " +
                            update.completed + " / " + update.total + (update.title ? " - " + update.title : "");
                    },
                });
                state.result = await collector.collect(document.location.href, source.expansion);
                state.result.report.member_storage = storage.mode;
                state.result.report.archive_limit_bytes = storage.limit;
                if (storage.unavailable) state.result.report.staging_unavailable = storage.unavailable;
                if (["cancelled", "failed"].includes(state.result.report.status)) {
                    toolbar.dataset.state = state.result.report.status;
                    status.textContent = state.result.report.status === "cancelled" ? "Cancelled" :
                        "Export failed: " + state.result.report.issues.join(", ");
                    return state.result;
                }
                await store("compendium.json", new Blob([JSON.stringify(state.result.manifest, null, 2)], { type: "application/json" }));
                await store("export_report.json", new Blob([JSON.stringify(state.result.report, null, 2)], { type: "application/json" }));
                status.textContent = "Writing ZIP";
                destination = await archive.openDestination(filename, saveHandle,
                    "R20Compendium-" + globalThis.crypto.randomUUID() + ".zip");
                await archive.exportZip(root, destination.writable, (current, total) => {
                    progress.max = Math.max(1, total || 1);
                    progress.value = current;
                }, { signal: controller.signal });
                if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
                await destination.deliver();
                const summary = state.result.report;
                count.textContent = quantity(summary.pages.captured, "captured page");
                toolbar.dataset.state = summary.status;
                status.textContent = summary.status === "partial"
                    ? "Partial export saved: " + quantity(summary.pages.failed, "missing page") + ", " +
                        quantity(summary.assets.failed + summary.assets.unsupported, "missing image")
                    : "Export saved: " + quantity(summary.pages.captured, "page") + ", " + quantity(summary.assets.bundled, "image");
                return state.result;
            } catch (error) {
                if (destination) await destination.abort().catch(() => undefined);
                const outcome = controller.signal.aborted ? "cancelled" : "failed";
                const reason = outcome === "cancelled" ? "cancelled" : "export-or-zip-write-failed";
                if (!state.result) state.result = { report: { status: outcome, issues: [reason] } };
                else {
                    state.result.report.capture_status = state.result.report.status;
                    state.result.report.status = outcome;
                    state.result.report.issues.push(reason);
                }
                toolbar.dataset.state = outcome;
                status.textContent = outcome === "cancelled" ? "Cancelled" : "Export failed: " + reason;
                return state.result;
            } finally {
                try { terminateWorkers(); } catch {}
                if (staging) await staging.dispose().catch(() => undefined);
                staging = null;
                state.running = false;
                start.disabled = false;
                cancel.hidden = true;
                progress.hidden = true;
                reportButton.disabled = !state.result;
            }
        }

        start.addEventListener("click", () => { void exportZip(); });
        cancel.addEventListener("click", () => {
            controller?.abort();
            cancel.disabled = true;
            status.textContent = "Cancelling";
        });
        reportButton.addEventListener("click", () => {
            if (state.result) save(new Blob([JSON.stringify(state.result.report, null, 2)], { type: "application/json" }),
                filename.replace(/\.zip$/, "-report.json"));
        });
        return state;
    }

    return { mount };
});