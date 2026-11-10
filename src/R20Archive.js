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

    // B012: a Blob kept from arrival until the ZIP is written can become
    // unreadable, which lost a whole DotMM export at its last step. Members are
    // persisted here as they arrive, and their ZIP entry reopens the persisted
    // file only when the archive is written.
    const STAGING_PREFIX = "R20Exporter-staging-";
    const STAGING_MAX_AGE_MS = 48 * 60 * 60 * 1000;

    function describeError(error) {
        if (!error) return String(error);
        const message = error.message || String(error);
        return error.name && error.name !== "Error" ? error.name + ": " + message : message;
    }

    async function removeAbandonedStaging(root, now) {
        if (typeof root.entries !== "function") return;
        const abandoned = [];
        try {
            for await (const [name, handle] of root.entries()) {
                if (handle.kind !== "directory" || !name.startsWith(STAGING_PREFIX)) continue;
                const created = Number(name.slice(STAGING_PREFIX.length).split("-")[0]);
                // Another tab may be exporting right now; only a directory far older
                // than any export can be assumed abandoned.
                if (Number.isFinite(created) && now - created > STAGING_MAX_AGE_MS) abandoned.push(name);
            }
        } catch {
            return;
        }
        for (const name of abandoned) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
    }

    async function openStagingStore() {
        const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
        if (!storage || typeof storage.getDirectory !== "function") {
            throw new Error("the origin private file system is unavailable");
        }
        const root = await storage.getDirectory();
        const now = Date.now();
        await removeAbandonedStaging(root, now);
        const name = STAGING_PREFIX + now + "-" + Math.random().toString(36).slice(2, 10);
        const directory = await root.getDirectoryHandle(name, { create: true });
        let next = 0;
        return {
            name,
            async persist(buffer) {
                const file = String(next++);
                const handle = await directory.getFileHandle(file, { create: true });
                let writable = null;
                try {
                    writable = await handle.createWritable();
                    await writable.write(buffer);
                    await writable.close();
                } catch (error) {
                    if (writable) await writable.abort().catch(() => undefined);
                    await directory.removeEntry(file).catch(() => undefined);
                    throw error;
                }
                return handle;
            },
            dispose: () => root.removeEntry(name, { recursive: true }).catch(() => undefined),
        };
    }

    function createLimiter(limit) {
        let active = 0;
        const queue = [];
        const next = () => {
            if (active >= limit || queue.length === 0) return;
            active += 1;
            const { task, resolve, reject } = queue.shift();
            Promise.resolve().then(task).then(resolve, reject).finally(() => {
                active -= 1;
                next();
            });
        };
        return (task) => new Promise((resolve, reject) => {
            queue.push({ task, resolve, reject });
            next();
        });
    }

    let MemberReader = null;

    // zip.js instantiates readers only when the archive is written, so the
    // persisted file is opened then, not when the member arrived.
    function memberReaderClass() {
        if (MemberReader) return MemberReader;
        MemberReader = class extends zip.Reader {
            constructor(member) {
                super();
                this.member = member;
                this.size = member.size;
            }

            async readUint8Array(offset, length) {
                const member = this.member;
                try {
                    if (!this.source) {
                        const source = member.handle ? await member.handle.getFile() : member.blob;
                        if (!source || source.size !== member.size) {
                            throw new Error("expected " + member.size + " bytes, found " + (source ? source.size : "none"));
                        }
                        this.source = source;
                    }
                    const end = offset + length;
                    const part = offset || end < this.source.size ? this.source.slice(offset, end) : this.source;
                    const bytes = new Uint8Array(await part.arrayBuffer());
                    if (end >= this.source.size) this.source = null;
                    return bytes;
                } catch (error) {
                    const wrapped = new Error("could not read " + member.path + " (" + describeError(error) + ")");
                    wrapped.cause = error;
                    throw wrapped;
                }
            }
        };
        return MemberReader;
    }

    function addMember(folder, filename, blob, path) {
        const member = { path: path || filename, size: blob.size, blob, handle: null };
        folder.addData(filename, { Reader: memberReaderClass(), data: member, uncompressedSize: member.size });
        return member;
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

    return {
        openDestination, exportZip, validateImageBlob,
        openStagingStore, createLimiter, addMember, describeError,
    };
});