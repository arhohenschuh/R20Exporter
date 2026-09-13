"use strict";

(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.R20Archive = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    async function openDestination(filename, saveHandle, tempName = "R20Exporter-tmp.zip") {
        if (saveHandle) {
            const writable = await saveHandle.createWritable();
            return { writable, deliver: () => undefined, abort: () => writable.abort() };
        }
        if (navigator.storage && navigator.storage.getDirectory) {
            const root = await navigator.storage.getDirectory();
            const handle = await root.getFileHandle(tempName, { create: true });
            let writable;
            try {
                writable = await handle.createWritable();
            } catch (error) {
                await root.removeEntry(tempName).catch(() => undefined);
                throw error;
            }
            return {
                writable,
                deliver: async () => {
                    saveAs(await handle.getFile(), filename);
                    setTimeout(() => root.removeEntry(tempName).catch(() => undefined), 60000);
                },
                abort: async () => {
                    await writable.abort().catch(() => undefined);
                    await root.removeEntry(tempName).catch(() => undefined);
                },
            };
        }
        const chunks = [];
        const writable = new WritableStream({ write: chunk => { chunks.push(chunk); } });
        return {
            writable,
            deliver: () => saveAs(new Blob(chunks, { type: "application/zip" }), filename),
            abort: async () => {
                await writable.abort().catch(() => undefined);
                chunks.length = 0;
            },
        };
    }

    function exportZip(zipFs, writable, onprogress, options = {}) {
        zip.configure({ useWebWorkers: true, maxWorkers: navigator.hardwareConcurrency || 4 });
        return zipFs.exportWritable(writable, {
            bufferedWrite: false,
            keepOrder: true,
            lastModDate: new Date(Date.UTC(1980, 0, 1, 0, 0, 0)),
            ...options,
            onprogress,
        });
    }

    function validateImageBlob(blob) {
        if (!blob || blob.size === 0) {
            return Promise.reject(new Error("image decode failed: the response body is empty"));
        }
        if (typeof globalThis.createImageBitmap !== "function") {
            return Promise.reject(new Error("image decode failed: createImageBitmap is unavailable"));
        }
        return Promise.all([
            blob.slice(0, 2).arrayBuffer(),
            blob.slice(Math.max(0, blob.size - 65536)).arrayBuffer(),
        ]).then(([headBuffer, tailBuffer]) => {
            const head = new Uint8Array(headBuffer);
            if (head.length < 2 || head[0] !== 0xFF || head[1] !== 0xD8) return;
            const tail = new Uint8Array(tailBuffer);
            for (let index = tail.length - 2; index >= 0; index--) {
                if (tail[index] === 0xFF && tail[index + 1] === 0xD9) return;
            }
            throw new Error("the JPEG EOI marker is missing");
        }).then(() => globalThis.createImageBitmap(blob)).then(bitmap => {
            try {
                if (!bitmap || bitmap.width < 1 || bitmap.height < 1) {
                    throw new Error("the decoded image has zero dimensions");
                }
            } finally {
                if (bitmap && typeof bitmap.close === "function") bitmap.close();
            }
        }).catch(error => {
            const reason = error && error.message ? error.message : String(error);
            if (reason.startsWith("image decode failed:")) throw error;
            throw new Error("image decode failed: " + reason);
        });
    }

    return { openDestination, exportZip, validateImageBlob };
});