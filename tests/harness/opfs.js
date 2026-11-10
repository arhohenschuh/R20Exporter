"use strict";

// An in-memory origin private file system with the handle surface the exporter
// uses. Writes land in a swap buffer and become visible on close(), as they do
// in Chromium's FileSystemWritableFileStream.

async function toBuffer(data) {
    if (data === undefined || data === null) return Buffer.alloc(0);
    if (typeof data === "string") return Buffer.from(data, "utf8");
    if (typeof data.arrayBuffer === "function") return Buffer.from(await data.arrayBuffer());
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (typeof data === "object" && data.type === "write") return toBuffer(data.data);
    throw new TypeError("unsupported write payload");
}

function notFound(name) {
    return new DOMException("A requested file or directory could not be found: " + name, "NotFoundError");
}

function createOpfs(options = {}) {
    const stats = { committed: 0, aborted: 0 };

    class FileHandle {
        constructor(name, parent) {
            this.kind = "file";
            this.name = name;
            this.parent = parent;
            this.bytes = Buffer.alloc(0);
        }

        path() {
            return this.parent.path() ? this.parent.path() + "/" + this.name : this.name;
        }

        removed() {
            for (let entry = this; entry; entry = entry.parent) {
                if (entry.detached) return true;
            }
            return false;
        }

        async createWritable() {
            if (this.removed()) throw notFound(this.name);
            if (options.failCreateWritable) {
                const error = options.failCreateWritable(this.path());
                if (error) throw error;
            }
            const file = this;
            const chunks = [];
            const stream = new WritableStream({
                async write(chunk) {
                    if (options.failWrite) {
                        const error = options.failWrite(file.path());
                        if (error) throw error;
                    }
                    chunks.push(await toBuffer(chunk));
                },
                close() {
                    file.bytes = Buffer.concat(chunks);
                    stats.committed += 1;
                },
                abort() {
                    chunks.length = 0;
                    stats.aborted += 1;
                },
            });
            stream.write = async (data) => {
                const writer = stream.getWriter();
                try {
                    await writer.write(data);
                } finally {
                    writer.releaseLock();
                }
            };
            return stream;
        }

        async getFile() {
            if (this.removed()) throw notFound(this.name);
            return new File([this.bytes], this.name);
        }
    }

    class DirectoryHandle {
        constructor(name, parent = null) {
            this.kind = "directory";
            this.name = name;
            this.parent = parent;
            this.children = new Map();
        }

        path() {
            if (!this.parent) return "";
            return this.parent.path() ? this.parent.path() + "/" + this.name : this.name;
        }

        async getDirectoryHandle(name, { create = false } = {}) {
            if (FileHandle.prototype.removed.call(this)) throw notFound(this.name);
            const existing = this.children.get(name);
            if (existing && existing.kind === "directory") return existing;
            if (existing) throw new DOMException("not a directory: " + name, "TypeMismatchError");
            if (!create) throw notFound(name);
            const directory = new DirectoryHandle(name, this);
            this.children.set(name, directory);
            return directory;
        }

        async getFileHandle(name, { create = false } = {}) {
            if (FileHandle.prototype.removed.call(this)) throw notFound(this.name);
            const existing = this.children.get(name);
            if (existing && existing.kind === "file") return existing;
            if (existing) throw new DOMException("not a file: " + name, "TypeMismatchError");
            if (!create) throw notFound(name);
            const file = new FileHandle(name, this);
            this.children.set(name, file);
            return file;
        }

        async removeEntry(name, { recursive = false } = {}) {
            const entry = this.children.get(name);
            if (!entry) throw notFound(name);
            if (entry.kind === "directory" && entry.children.size > 0 && !recursive) {
                throw new DOMException("directory is not empty: " + name, "InvalidModificationError");
            }
            entry.detached = true;
            this.children.delete(name);
        }

        async *entries() {
            for (const entry of Array.from(this.children.entries())) yield entry;
        }

        async *keys() {
            for (const name of Array.from(this.children.keys())) yield name;
        }

        async *values() {
            for (const handle of Array.from(this.children.values())) yield handle;
        }
    }

    const root = new DirectoryHandle("");
    const navigator = {
        hardwareConcurrency: 4,
        storage: { getDirectory: async () => root },
    };
    return { root, navigator, stats };
}

module.exports = { createOpfs };
