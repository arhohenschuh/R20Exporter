"use strict";

function compendiumUrl(value, base, expansion) {
    const address = new URL(value, base);
    const source = new URL(base);
    const systemPath = source.pathname.split("/").slice(0, 3).join("/") + "/";
    if (address.protocol !== "https:" || !["app.roll20.net", "roll20.net"].includes(address.hostname) ||
        address.port || address.username || address.password ||
        !address.pathname.startsWith(systemPath) || address.pathname === systemPath) {
        throw new Error("outside-selected-compendium");
    }
    const expansions = address.searchParams.getAll("expansion");
    if (expansions.length > 1 || (expansions.length && expansions[0] !== expansion)) {
        throw new Error("different-expansion");
    }
    if ([...address.searchParams.keys()].some(key => key !== "expansion")) {
        throw new Error("unsupported-query");
    }
    address.hostname = "app.roll20.net";
    address.hash = "";
    address.searchParams.set("expansion", expansion);
    return address.href;
}

function compendiumUrlIdentity(value) {
    const address = new URL(value);
    return JSON.stringify([
        address.origin,
        address.pathname.split("/").map(segment => decodeURIComponent(segment)),
        address.search,
    ]);
}

function planCompendiumLinks(indexUrl, expansion, links) {
    if (!/^\d+$/.test(expansion)) throw new Error("missing-expansion-identity");
    const index = new URL(indexUrl);
    if (!/^\/compendium\/[^/]+\/[^/]+$/.test(index.pathname)) {
        throw new Error("invalid-compendium-index");
    }
    const indexRequest = compendiumUrl(indexUrl, indexUrl, expansion);
    const indexIdentity = compendiumUrlIdentity(indexRequest);
    const pages = [];
    const excluded = [];
    const identities = new Map();
    for (const link of links) {
        if (!link.href || link.href.startsWith("#")) continue;
        try {
            const requestUrl = compendiumUrl(link.href, indexUrl, expansion);
            const identity = compendiumUrlIdentity(requestUrl);
            if (identity === indexIdentity) continue;
            if (!identities.has(identity)) {
                const page = { requestUrl, links: [] };
                identities.set(identity, page);
                pages.push(page);
            }
            identities.get(identity).links.push({
                href: link.href,
                label: link.label || "",
                category: link.category || "",
                ...(link.discoveredOn ? { discoveredOn: link.discoveredOn, relation: link.relation } : {}),
            });
        } catch (error) {
            excluded.push({ label: link.label || "", reason: error.message });
        }
    }
    return { indexUrl, indexRequest, expansion, pages, excluded };
}

function compendiumError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function readCompendiumDocument(document, responseUrl, expectedExpansion) {
    const contents = Array.from(document.querySelectorAll("#pagecontent"))
        .filter(element => !element.parentElement?.closest("#pagecontent"));
    if (contents.length !== 1) {
        throw compendiumError("missing-or-ambiguous-content");
    }
    const content = contents[0];
    const owner = content.closest("[data-expansionid]");
    const expansion = owner && owner.getAttribute("data-expansionid");
    const pageId = content.getAttribute("data-pageid");
    if (!/^\d+$/.test(expansion || "") || !/^\d+$/.test(pageId || "")) {
        throw compendiumError("missing-source-identity");
    }
    if (expectedExpansion && expansion !== expectedExpansion) {
        throw compendiumError("wrong-source-expansion");
    }
    compendiumUrl(responseUrl, responseUrl, expansion);
    const heading = owner.querySelector("h1");
    const source = owner.querySelector(".page-header-source");
    if (!heading || !heading.textContent.trim() || !source) {
        throw compendiumError("missing-source-header");
    }
    const title = heading.textContent.trim();
    const isIndex = Array.from(source.querySelectorAll("a[href]")).some(link => {
        try {
            return link.textContent.trim() === title &&
                compendiumUrlIdentity(compendiumUrl(link.getAttribute("href"), responseUrl, expansion)) ===
                compendiumUrlIdentity(compendiumUrl(responseUrl, responseUrl, expansion));
        } catch {
            return false;
        }
    });
    const attributeContainers = document.querySelectorAll("#pageAttrs");
    if (attributeContainers.length > 1) throw compendiumError("ambiguous-attributes");
    const attributeContainer = attributeContainers[0];
    const attributes = attributeContainer ? Array.from(attributeContainer.querySelectorAll(".attrListItem")).map(row => {
        const names = row.querySelectorAll(".attrName");
        const values = row.querySelectorAll(".attrValue");
        if (names.length !== 1 || values.length !== 1) throw compendiumError("malformed-attribute");
        return { name: names[0].textContent, value: values[0].textContent, html: values[0].innerHTML };
    }) : [];
    if (!content.textContent.trim() && !content.querySelector("img[src]") &&
        !attributes.some(attribute => attribute.name.trim() && attribute.value.trim())) {
        throw compendiumError("empty-compendium-entry");
    }
    const links = [];
    let category = "Front matter";
    for (const element of content.querySelectorAll("h2,h3,h4,a[href]")) {
        if (element.tagName !== "A") {
            category = element.textContent.trim() || category;
        } else {
            links.push({ href: element.getAttribute("href"), label: element.textContent.trim(), category });
        }
    }
    const navigation = Array.from(document.querySelectorAll(".page-links a[href]")).map(link => ({
        href: link.getAttribute("href"),
        label: link.getAttribute("title") || link.textContent.trim(),
        category: "Book navigation",
    }));
    const illustrations = Array.from(document.querySelectorAll("#mainContent .toccol img"))
        .filter(image => !content.contains(image));
    const media = [];
    const unsupported = [];
    const fragments = [content, attributeContainer, ...illustrations].filter(Boolean);
    const seen = new Set();
    for (const fragment of fragments) {
        const elements = [fragment, ...fragment.querySelectorAll("*")];
        for (const element of elements) {
            if (seen.has(element)) continue;
            seen.add(element);
            if (element.matches("img,source,video,audio")) {
                for (const attribute of ["src", "poster"]) {
                    if (element.hasAttribute(attribute)) media.push({
                        value: element.getAttribute(attribute), attribute, element: element.tagName.toLowerCase(),
                    });
                }
                if (element.hasAttribute("srcset")) unsupported.push("srcset");
            }
            if (element.matches("iframe,object,embed")) unsupported.push(element.tagName.toLowerCase());
            if (/url\s*\(/i.test(element.getAttribute("style") || "")) unsupported.push("inline-css-url");
        }
    }
    return {
        title, pageId, expansion, responseUrl, isIndex, links, navigation, media, unsupported,
        contentHtml: content.innerHTML,
        attributesHtml: attributeContainer ? attributeContainer.innerHTML : "",
        illustrationsHtml: illustrations.map(image => image.outerHTML).join("\n"),
        attributes,
    };
}

function compendiumDiscoveryLinks(page) {
    const explicitlyScoped = link => {
        try {
            const target = new URL(link.href, page.responseUrl);
            return target.searchParams.getAll("expansion").length === 1 &&
                target.searchParams.get("expansion") === page.expansion;
        } catch {
            return false;
        }
    };
    const bodyLinks = page.isIndex ? page.links :
        page.attributes.length === 0 ? page.links.filter(explicitlyScoped) : [];
    return [
        ...bodyLinks.map(link => ({ ...link, discoveredOn: page.responseUrl,
            relation: page.isIndex ? "index" : "catalogue" })),
        ...page.navigation.filter(explicitlyScoped).map(link => ({ ...link,
            discoveredOn: page.responseUrl, relation: "book-navigation" })),
    ];
}

function compendiumAssetUrl(value, base) {
    if (/^data:image\//i.test(value)) return null;
    const address = new URL(value, base);
    const allowedHost = address.hostname === "files.d20.io" ||
        (address.hostname === "s3.amazonaws.com" && address.pathname.startsWith("/files.d20.io/"));
    if (!allowedHost || address.protocol !== "https:" || address.port || address.username || address.password) {
        throw compendiumError("unsupported-asset-origin");
    }
    address.hash = "";
    return address.href;
}

function compendiumAbortable(promise, signal) {
    if (signal.aborted) {
        Promise.resolve(promise).catch(() => undefined);
        return Promise.reject(signal.reason);
    }
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve(promise).then(value => {
            signal.removeEventListener("abort", abort);
            resolve(value);
        }, error => {
            signal.removeEventListener("abort", abort);
            reject(error);
        });
    });
}

function compendiumDelay(milliseconds, signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
        }, Math.max(0, milliseconds));
        signal.addEventListener("abort", abort, { once: true });
    });
}

async function readCompendiumBody(response, limit, signal) {
    if (Number(response.headers.get("content-length")) > limit) throw compendiumError("response-size-limit");
    if (!response.body) throw compendiumError("empty-response");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const chunk = await compendiumAbortable(reader.read(), signal);
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > limit) throw compendiumError("response-size-limit");
            chunks.push(chunk.value);
        }
    } catch (error) {
        reader.cancel().catch(() => undefined);
        throw error;
    } finally {
        reader.releaseLock();
    }
    return new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
}

async function compendiumHash(blob) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

function parseCompendiumHtml(document, html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content;
}

class R20CompendiumCollector {
    constructor(options) {
        if (typeof options.store !== "function") throw compendiumError("missing-archive-store");
        this.store = options.store;
        this.fetch = options.fetch || globalThis.fetch.bind(globalThis);
        this.parseHtml = options.parseHtml || (html => parseCompendiumHtml(document, html));
        this.validateImage = options.validateImage || globalThis.R20Archive.validateImageBlob;
        this.signal = options.signal || new AbortController().signal;
        this.onProgress = options.onProgress || (() => undefined);
        this.intervalMs = options.intervalMs ?? 1000;
        this.timeoutMs = options.timeoutMs ?? 30000;
        this.maxAttempts = options.maxAttempts ?? 3;
        this.maxPages = options.maxPages ?? 2000;
        this.maxPageBytes = options.maxPageBytes ?? 8 * 1024 * 1024;
        this.maxAssetBytes = options.maxAssetBytes ?? 32 * 1024 * 1024;
        this.maxArchiveBytes = options.maxArchiveBytes ?? 512 * 1024 * 1024;
        this.version = options.version || globalThis.R20EXPORTER_VERSION;
        this.nextRequestAt = 0;
        this.totalBytes = 0;
        this.pages = [];
        this.requestAliases = [];
        this.assets = [];
        this.assetUrls = new Map();
        this.members = new Set();
    }

    async request(url, kind) {
        const attempts = [];
        for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
            await compendiumDelay(this.nextRequestAt - Date.now(), this.signal);
            const controller = new AbortController();
            const abort = () => controller.abort(this.signal.reason);
            this.signal.addEventListener("abort", abort, { once: true });
            if (this.signal.aborted) abort();
            const timer = setTimeout(() => controller.abort(compendiumError("request-timeout")), this.timeoutMs);
            const detail = { attempt: attempt + 1, status: null, outcome: "pending" };
            attempts.push(detail);
            let retryDelay = Math.pow(2, attempt) * 1000;
            let failure;
            try {
                this.nextRequestAt = Date.now() + this.intervalMs;
                const response = await compendiumAbortable(this.fetch(url, {
                    credentials: kind === "page" ? "same-origin" : "omit",
                    redirect: "error",
                    signal: controller.signal,
                }), controller.signal);
                detail.status = response.status;
                if (response.redirected || (response.url && response.url !== url)) {
                    if (response.body) response.body.cancel().catch(() => undefined);
                    throw compendiumError("unexpected-response-url");
                }
                if (response.status !== 200) {
                    const retryAfter = response.headers.get("retry-after");
                    if (retryAfter) {
                        const seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
                        if (Number.isFinite(seconds)) retryDelay = Math.max(0, seconds);
                    }
                    if (response.body) response.body.cancel().catch(() => undefined);
                    throw compendiumError("http-" + response.status);
                }
                if (kind === "page" && !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(response.headers.get("content-type") || "")) {
                    if (response.body) response.body.cancel().catch(() => undefined);
                    throw compendiumError("unexpected-content-type");
                }
                const body = await readCompendiumBody(response,
                    kind === "page" ? this.maxPageBytes : this.maxAssetBytes, controller.signal);
                if (kind === "asset") {
                    try {
                        await compendiumAbortable(this.validateImage(body), controller.signal);
                    } catch (error) {
                        if (controller.signal.aborted) throw error;
                        throw compendiumError("invalid-image");
                    }
                }
                detail.outcome = "received";
                detail.bytes = body.size;
                return { body, responseUrl: response.url || url, attempts };
            } catch (error) {
                const reason = controller.signal.aborted ? controller.signal.reason : error;
                failure = compendiumError(this.signal.aborted ? "cancelled" :
                    (typeof reason?.code === "string" ? reason.code : "network-error"));
                detail.outcome = failure.code;
                failure.attempts = attempts;
            } finally {
                clearTimeout(timer);
                this.signal.removeEventListener("abort", abort);
            }
            const retryable = /^(network-error|request-timeout|http-429|http-5\d\d)$/.test(failure.code);
            if (!retryable || attempt + 1 >= this.maxAttempts || retryDelay > 120000) throw failure;
            await compendiumDelay(retryDelay, this.signal);
        }
        throw compendiumError("no-request-attempts");
    }

    async write(path, blob) {
        if (this.signal.aborted) throw compendiumError("cancelled");
        if (this.members.has(path)) throw Object.assign(compendiumError("duplicate-archive-member"), { fatal: true });
        if (this.totalBytes + blob.size > this.maxArchiveBytes) {
            throw Object.assign(compendiumError("archive-size-limit"), { fatal: true });
        }
        const sha256 = await compendiumHash(blob);
        try {
            await this.store(path, blob);
        } catch {
            throw Object.assign(compendiumError("archive-write-failed"), { fatal: true });
        }
        this.members.add(path);
        this.totalBytes += blob.size;
        return { path, bytes: blob.size, sha256 };
    }

    async capturePage(data, record) {
        const identity = await compendiumHash(new Blob([record.requestUrl]));
        const prefix = "pages/" + data.pageId + "-" + identity.slice(0, 16) + "/";
        record.files = [];
        for (const [name, value, type] of [
            ["pagecontent.html", data.contentHtml, "text/html"],
            ["pageattrs.html", data.attributesHtml, "text/html"],
            ["attributes.json", JSON.stringify(data.attributes, null, 2), "application/json"],
            ["illustrations.html", data.illustrationsHtml, "text/html"],
        ]) {
            record.files.push(await this.write(prefix + name, new Blob([value], { type })));
        }
        Object.assign(record, {
            outcome: "captured", title: data.title, pageId: data.pageId,
            expansion: data.expansion, responseUrl: data.responseUrl, attributeCount: data.attributes.length,
        });
        for (const reason of data.unsupported) {
            this.assets.push({ outcome: "unsupported", reason, references: [{ page: record.requestUrl }] });
        }
        for (const media of data.media) {
            const reference = { page: record.requestUrl, attribute: media.attribute, element: media.element };
            try {
                const url = compendiumAssetUrl(media.value, data.responseUrl);
                if (url === null) {
                    this.assets.push({ outcome: "embedded", references: [reference] });
                } else if (this.assetUrls.has(url)) {
                    this.assetUrls.get(url).references.push(reference);
                } else {
                    const asset = { url, outcome: "pending", references: [reference] };
                    this.assetUrls.set(url, asset);
                    this.assets.push(asset);
                }
            } catch (error) {
                this.assets.push({ outcome: "unsupported", reason: error.code || "invalid-asset-url", references: [reference] });
            }
        }
    }

    async collect(indexUrl, expansion) {
        if (this.pages.length) throw compendiumError("collector-already-used");
        const indexRequest = planCompendiumLinks(indexUrl, expansion, []).indexRequest;
        const index = { requestUrl: indexRequest, kind: "index", outcome: "pending", links: [] };
        this.pages.push(index);
        const source = { indexUrl, expansion };
        let excluded = [];
        let failure = null;
        const queue = [index];
        const requests = new Map([[compendiumUrlIdentity(indexRequest), index]]);
        const capturedIds = new Map();
        const discover = data => {
            const plan = planCompendiumLinks(indexUrl, expansion, compendiumDiscoveryLinks(data));
            const additional = plan.pages.filter(page => !requests.has(compendiumUrlIdentity(page.requestUrl)));
            if (requests.size + additional.length > this.maxPages) {
                throw Object.assign(compendiumError("page-count-limit"), { fatal: true });
            }
            excluded.push(...plan.excluded.map(link => ({ ...link, discoveredOn: data.responseUrl })));
            for (const page of plan.pages) {
                const identity = compendiumUrlIdentity(page.requestUrl);
                if (requests.has(identity)) {
                    requests.get(identity).links.push(...page.links);
                } else {
                    const record = { ...page, kind: "entry", outcome: "pending" };
                    requests.set(identity, record);
                    this.pages.push(record);
                    queue.push(record);
                }
            }
        };
        const fingerprint = data => compendiumHash(new Blob([JSON.stringify([
            data.contentHtml, data.attributesHtml, data.illustrationsHtml,
        ])]));
        try {
            this.onProgress({ phase: "index", completed: 0, total: 1 });
            const received = await this.request(indexRequest, "page");
            index.attempts = received.attempts;
            const data = readCompendiumDocument(this.parseHtml(await received.body.text()), received.responseUrl, expansion);
            if (!data.isIndex) throw compendiumError("not-a-book-index");
            discover(data);
            if (queue.length === 1) throw compendiumError("empty-book-index");
            Object.assign(source, { title: data.title, pageId: data.pageId });
            await this.capturePage(data, index);
            capturedIds.set(data.pageId, { record: index, fingerprint: await fingerprint(data) });
            for (let position = 1; position < queue.length; position++) {
                const record = queue[position];
                this.onProgress({ phase: "pages", completed: this.pages.filter(page => page.outcome !== "pending").length, total: this.pages.length, title: record.links[0]?.label });
                try {
                    const received = await this.request(record.requestUrl, "page");
                    record.attempts = received.attempts;
                    const page = readCompendiumDocument(this.parseHtml(await received.body.text()), received.responseUrl, expansion);
                    const contentFingerprint = await fingerprint(page);
                    const previous = capturedIds.get(page.pageId);
                    if (previous) {
                        if (previous.fingerprint !== contentFingerprint) {
                            throw Object.assign(compendiumError("conflicting-page-alias"), { fatal: true });
                        }
                        discover(page);
                        this.requestAliases.push({ requestUrl: record.requestUrl, responseUrl: page.responseUrl,
                            pageId: page.pageId, expansion, canonicalRequestUrl: previous.record.requestUrl,
                            links: record.links, attempts: record.attempts });
                        this.pages.splice(this.pages.indexOf(record), 1);
                        continue;
                    }
                    discover(page);
                    await this.capturePage(page, record);
                    capturedIds.set(page.pageId, { record, fingerprint: contentFingerprint });
                } catch (error) {
                    record.outcome = this.signal.aborted ? "cancelled" : "failed";
                    record.reason = error.code || "capture-error";
                    record.attempts = error.attempts || record.attempts || [];
                    if (this.signal.aborted || error.fatal) throw error;
                }
            }
            for (const asset of this.assets) {
                if (asset.outcome !== "pending") continue;
                this.onProgress({ phase: "assets", completed: this.assets.filter(row => row.outcome !== "pending").length, total: this.assets.length });
                try {
                    const received = await this.request(asset.url, "asset");
                    asset.attempts = received.attempts;
                    const sha256 = await compendiumHash(received.body);
                    const extension = new URL(asset.url).pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1].toLowerCase() || "bin";
                    const path = "assets/" + sha256 + "." + extension;
                    const file = this.members.has(path) ? { path, sha256, bytes: received.body.size } : await this.write(path, received.body);
                    Object.assign(asset, file, { outcome: "bundled", servedFrom: received.responseUrl, contentType: received.body.type });
                } catch (error) {
                    asset.outcome = this.signal.aborted ? "cancelled" : "failed";
                    asset.reason = error.code || "capture-error";
                    asset.attempts = error.attempts || asset.attempts || [];
                    if (this.signal.aborted || error.fatal) throw error;
                }
            }
        } catch (error) {
            failure = this.signal.aborted ? "cancelled" : error.code || "capture-error";
            if (index.outcome === "pending") index.attempts = error.attempts || index.attempts || [];
        }
        for (const record of [...this.pages, ...this.assets]) {
            if (record.outcome === "pending") {
                record.outcome = this.signal.aborted ? "cancelled" : "failed";
                record.reason = failure || "unfinished-capture";
            }
        }
        const pageTotals = { planned: this.pages.length, captured: 0, failed: 0, cancelled: 0 };
        const assetTotals = { planned: this.assets.length, bundled: 0, embedded: 0, failed: 0, unsupported: 0, cancelled: 0 };
        for (const record of this.pages) pageTotals[record.outcome]++;
        for (const record of this.assets) assetTotals[record.outcome]++;
        const status = this.signal.aborted ? "cancelled" : failure ? "failed" :
            (pageTotals.failed || assetTotals.failed || assetTotals.unsupported) ? "partial" : "complete-within-index";
        return {
            manifest: {
                R20Compendium_format: "1.0", exporter_version: this.version,
                capture_format: "dom-serialized-html-and-ordered-attributes",
                scope: "selected-book-catalogue-and-navigation", source,
                pages: this.pages, assets: this.assets, excludedLinks: excluded,
                requestAliases: this.requestAliases,
            },
            report: {
                format_version: "1.0", exporter_version: this.version, status,
                captured_at: new Date().toISOString(), source,
                scope: "selected-book-catalogue-and-navigation", unlinked_content: "not-discovered",
                pages: pageTotals, assets: assetTotals, stored_bytes: this.totalBytes,
                discovery: { pageRequests: requests.size, aliases: this.requestAliases.length,
                    excludedLinks: excluded.length },
                issues: failure ? [failure] : [],
                failures: [...this.pages, ...this.assets].filter(record => ["failed", "cancelled", "unsupported"].includes(record.outcome)),
            },
        };
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { compendiumUrl, planCompendiumLinks, readCompendiumDocument, parseCompendiumHtml, compendiumDiscoveryLinks, compendiumAssetUrl, R20CompendiumCollector };
} else {
    globalThis.R20Compendium = { planCompendiumLinks, readCompendiumDocument, compendiumDiscoveryLinks, R20CompendiumCollector };
}