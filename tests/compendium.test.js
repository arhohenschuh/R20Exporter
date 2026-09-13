"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { planCompendiumLinks, readCompendiumDocument, parseCompendiumHtml, compendiumAssetUrl, R20CompendiumCollector } = require("../src/R20Compendium.js");
const { mount } = require("../src/R20CompendiumPage.js");

const INDEX = "https://app.roll20.net/compendium/dnd5e/Example%20Book#content";
const windows = [];

afterEach(() => {
    for (const window of windows.splice(0)) window.close();
});

test("compendium plan freezes direct links and retains original source evidence", () => {
    const links = [
        { href: "/compendium/dnd5e/Example%20Item#content", label: "Example Item", category: "Items" },
        { href: "/compendium/dnd5e/Example%20Item?expansion=4962#attributes", label: "Again", category: "References" },
        { href: "/compendium/dnd5e/Monsters:Example%20Item?expansion=4962", category: "Monsters" },
        { href: "#toc_1" },
        { href: INDEX },
    ];
    const original = JSON.stringify(links);
    const plan = planCompendiumLinks(INDEX, "4962", links);
    assert.equal(plan.pages.length, 2);
    assert.deepEqual(plan.pages[0].links, links.slice(0, 2));
    assert.equal(plan.pages[0].requestUrl,
        "https://app.roll20.net/compendium/dnd5e/Example%20Item?expansion=4962");
    assert.equal(plan.pages[1].links[0].category, "Monsters");
    assert.deepEqual(plan.excluded, []);
    assert.equal(JSON.stringify(links), original);
});

test("compendium plan recognizes encoded apostrophes without rewriting source URLs", () => {
    const index = "https://app.roll20.net/compendium/dnd5e/Storm%20King%27s%20Thunder#content";
    const links = [
        { href: "/compendium/dnd5e/Storm King's Thunder#content", label: "Source", category: "Book" },
        { href: "/compendium/dnd5e/King%27s%20Ring#content", label: "Ring", category: "Items" },
        { href: "/compendium/dnd5e/King's%20Ring?expansion=7387", label: "Ring again", category: "References" },
    ];
    const original = JSON.stringify(links);
    const plan = planCompendiumLinks(index, "7387", links);
    assert.equal(plan.pages.length, 1);
    assert.deepEqual(plan.pages[0].links, links.slice(1));
    assert.equal(plan.pages[0].requestUrl,
        "https://app.roll20.net/compendium/dnd5e/King%27s%20Ring?expansion=7387");
    assert.equal(plan.indexUrl, index);
    assert.equal(JSON.stringify(links), original);
});

test("compendium URL identity preserves encoded path boundaries and literal percent signs", () => {
    const paths = ["King%2FRing", "King/Ring", "King%252FRing", "King%3FRing", "king%2FRing"];
    const links = paths.map(name => ({ href: "/compendium/dnd5e/" + name }));
    const plan = planCompendiumLinks(INDEX, "4962", links);
    assert.equal(plan.pages.length, paths.length);
    assert.deepEqual(plan.pages.map(page => page.links[0].href), links.map(link => link.href));
    assert.deepEqual(plan.excluded, []);
});

test("compendium plan accepts the exact Roll20 web alias and preserves original hrefs", () => {
    const links = [
        { href: "https://roll20.net/compendium/dnd5e/Rules:Bestiary?expansion=7387#content", label: "Bestiary", category: "Appendices" },
        { href: "https://app.roll20.net/compendium/dnd5e/Rules:Bestiary?expansion=7387", label: "Bestiary again", category: "References" },
        { href: "https://roll20.net/compendium/dnd5e/Rules:Magic%20Items", label: "Magic Items", category: "Appendices" },
    ];
    const plan = planCompendiumLinks(INDEX, "7387", links);
    assert.equal(plan.pages.length, 2);
    assert.equal(plan.pages[0].requestUrl, "https://app.roll20.net/compendium/dnd5e/Rules:Bestiary?expansion=7387");
    assert.equal(plan.pages[1].requestUrl, "https://app.roll20.net/compendium/dnd5e/Rules:Magic%20Items?expansion=7387");
    assert.deepEqual(plan.pages[0].links, links.slice(0, 2));
    assert.deepEqual(plan.excluded, []);
});

test("compendium plan excludes other books, origins, systems and ambiguous queries", () => {
    const forbidden = [
        "https://example.org/compendium/dnd5e/Entry",
        "https://app.roll20.net.evil.example/compendium/dnd5e/Entry",
        "https://roll20.net.evil.example/compendium/dnd5e/Entry",
        "http://roll20.net/compendium/dnd5e/Entry",
        "https://user:secret@roll20.net/compendium/dnd5e/Entry",
        "https://roll20.net:8443/compendium/dnd5e/Entry",
        "http://app.roll20.net/compendium/dnd5e/Entry",
        "https://user:secret@app.roll20.net/compendium/dnd5e/Entry",
        "/compendium/pf2/Entry",
        "/compendium/dnd5e/Entry?expansion=9999",
        "/compendium/dnd5e/Entry?expansion=4962&expansion=4962",
        "/compendium/dnd5e/Entry?token=private",
        "/login",
        "javascript:alert(1)",
    ];
    const plan = planCompendiumLinks(INDEX, "4962", forbidden.map(href => ({ href })));
    assert.equal(plan.pages.length, 0);
    assert.equal(plan.excluded.length, forbidden.length);
    assert.ok(plan.excluded.every(row => row.reason));
});

test("compendium plan refuses a missing book identity or invalid index", () => {
    assert.throws(() => planCompendiumLinks(INDEX, "", []), /missing-expansion-identity/);
    assert.throws(() => planCompendiumLinks(INDEX, "4962&expansion=1", []), /missing-expansion-identity/);
    assert.throws(() => planCompendiumLinks("https://example.org/compendium/dnd5e/Book", "4962", []),
        /outside-selected-compendium/);
    assert.throws(() => planCompendiumLinks("https://app.roll20.net/login", "4962", []),
        /invalid-compendium-index/);
});

function documentHtml(options = {}) {
    return `<!doctype html><html><body><nav>PRIVATE_ACCOUNT_SENTINEL</nav>
        <div id="mainContent"><div class="toccol"><img src="https://files.d20.io/images/portrait.png"></div>
        <div class="content-text" data-expansionid="${options.expansion || "4962"}">
        <h1>${options.title || "Example Book"}</h1>
        <div class="page-header-source">Source: <a href="/compendium/dnd5e/Example%20Book#content">Example Book</a></div>
        <div id="pagecontent" data-pageid="${options.pageId || "123"}">${options.content || '<h3>Items</h3><a href="/compendium/dnd5e/Example%20Item">Example Item</a>'}</div>
        <div id="pageAttrs">${options.attributes || ""}</div></div></div>
        <script>const credential = "PRIVATE_TOKEN_SENTINEL";</script></body></html>`;
}

function parseHtml(html) {
    const window = new JSDOM(html).window;
    windows.push(window);
    return window.document;
}

test("compendium parser identifies the book and captures only scoped fragments", () => {
    const capture = readCompendiumDocument(parseHtml(documentHtml()), INDEX, "4962");
    assert.equal(capture.isIndex, true);
    assert.equal(capture.expansion, "4962");
    assert.equal(capture.pageId, "123");
    assert.equal(capture.links[0].category, "Items");
    assert.equal(capture.media.length, 1);
    assert.match(capture.illustrationsHtml, /portrait\.png/);
    assert.doesNotMatch(JSON.stringify(capture), /PRIVATE_.*_SENTINEL/);
});

test("Storm King's Thunder toolbar mounts when its source href uses a literal apostrophe", () => {
    const index = "https://app.roll20.net/compendium/dnd5e/Storm%20King%27s%20Thunder#content";
    const window = new JSDOM(documentHtml({ title: "Storm King's Thunder", expansion: "7387", pageId: "75774" }), { url: index }).window;
    windows.push(window);
    const link = window.document.querySelector(".page-header-source a");
    link.textContent = "Storm King's Thunder";
    link.setAttribute("href", "/compendium/dnd5e/Storm King's Thunder#content");
    const parsed = readCompendiumDocument(window.document, index, "7387");
    assert.equal(parsed.isIndex, true);
    const instance = mount(window.document, { createCollector: () => assert.fail("must stay idle") });
    assert.ok(instance);
    assert.equal(instance.running, false);
    assert.equal(window.document.querySelector("#r20compendium-export").textContent, "Export Compendium");
});

test("production HTML parsing keeps downloaded images and frames in an inert template", () => {
    const document = parseHtml("<!doctype html><html><body></body></html>");
    const fragment = parseCompendiumHtml(document, documentHtml());
    assert.equal(fragment.nodeType, 11);
    assert.equal(fragment.querySelector("img").isConnected, false);
    assert.equal(document.querySelector("img"), null);
    const capture = readCompendiumDocument(fragment, INDEX, "4962");
    assert.equal(capture.isIndex, true);
    assert.equal(capture.links.length, 1);
});

test("compendium parser retains DOM markup, whitespace and duplicate attributes", () => {
    const content = '<p id="anchor">A &amp; B <em>\u03a9</em></p>';
    const attributes = '<div class="attrListItem"><div class="attrName"> HP </div><div class="attrValue"> 7 <b>points</b> </div></div>'.repeat(2);
    const capture = readCompendiumDocument(parseHtml(documentHtml({ title: "Example Item", content, attributes })),
        "https://app.roll20.net/compendium/dnd5e/Example%20Item?expansion=4962", "4962");
    assert.equal(capture.isIndex, false);
    assert.equal(capture.contentHtml, content);
    assert.equal(capture.attributesHtml, attributes);
    assert.deepEqual(capture.attributes, [
        { name: " HP ", value: " 7 points ", html: " 7 <b>points</b> " },
        { name: " HP ", value: " 7 points ", html: " 7 <b>points</b> " },
    ]);
});

test("attribute-only NPC entries remain valid when narrative text is empty", () => {
    const attributes = '<div class="attrListItem"><div class="attrName">HP</div><div class="attrValue">12</div></div>';
    const capture = readCompendiumDocument(parseHtml(documentHtml({
        title: "Example NPC", content: "\n<!-- no narrative -->\n", attributes,
    })), "https://app.roll20.net/compendium/dnd5e/Example%20NPC?expansion=4962", "4962");
    assert.equal(capture.title, "Example NPC");
    assert.equal(capture.attributes.length, 1);
    assert.equal(capture.contentHtml, "\n<!-- no narrative -->\n");
    assert.throws(() => readCompendiumDocument(parseHtml(documentHtml({ content: "\n " })), INDEX, "4962"),
        /empty-compendium-entry/);
});

test("source-identified content can contain a nested duplicate content id", () => {
    const content = '<div id="pagecontent"><p>Original item text</p><img src="https://files.d20.io/images/item.png"></div>';
    const capture = readCompendiumDocument(parseHtml(documentHtml({ title: "Example Item", content })),
        "https://app.roll20.net/compendium/dnd5e/Example%20Item?expansion=4962", "4962");
    assert.equal(capture.pageId, "123");
    assert.equal(capture.expansion, "4962");
    assert.equal(capture.contentHtml, content);
    assert.equal(capture.media.filter(media => media.value.endsWith("item.png")).length, 1);
    assert.throws(() => readCompendiumDocument(parseHtml(documentHtml({ content }).replace('id="pageAttrs"', 'id="pagecontent"')),
        INDEX, "4962"), /missing-or-ambiguous-content/);
    assert.throws(() => readCompendiumDocument(parseHtml(documentHtml({ content, expansion: "9999" })),
        INDEX, "4962"), /wrong-source-expansion/);
});

test("compendium parser rejects login HTML, missing identities and wrong-source pages", () => {
    assert.throws(() => readCompendiumDocument(parseHtml('<form><input type="password"></form>'), INDEX, "4962"),
        /missing-or-ambiguous-content/);
    assert.throws(() => readCompendiumDocument(parseHtml(documentHtml({ expansion: "9999" })), INDEX, "4962"),
        /wrong-source-expansion/);
    assert.throws(() => readCompendiumDocument(parseHtml(documentHtml().replace('data-pageid="123"', "")), INDEX, "4962"),
        /missing-source-identity/);
    assert.throws(() => readCompendiumDocument(parseHtml(documentHtml().replace('id="pageAttrs"', 'id="pagecontent"')), INDEX, "4962"),
        /missing-or-ambiguous-content/);
    assert.throws(() => readCompendiumDocument(parseHtml(documentHtml({ attributes: '<div class="attrListItem">broken</div>' })), INDEX, "4962"),
        /malformed-attribute/);
});

test("unsupported media is reported rather than silently claiming full asset coverage", () => {
    const capture = readCompendiumDocument(parseHtml(documentHtml({
        content: '<p style="background-image:url(other.png)">Text</p><img src="https://files.d20.io/images/art.png" srcset="other.png 2x"><iframe src="https://example.org"></iframe>',
    })), INDEX, "4962");
    assert.deepEqual(capture.unsupported, ["inline-css-url", "srcset", "iframe"]);
    assert.equal(capture.media.length, 2);
});

test("asset requests are restricted to Roll20 media hosts", () => {
    assert.equal(compendiumAssetUrl("https://files.d20.io/images/art.png?123", INDEX),
        "https://files.d20.io/images/art.png?123");
    assert.equal(compendiumAssetUrl("https://s3.amazonaws.com/files.d20.io/images/art.png", INDEX),
        "https://s3.amazonaws.com/files.d20.io/images/art.png");
    assert.equal(compendiumAssetUrl("data:image/png;base64,AA==", INDEX), null);
    for (const value of ["http://files.d20.io/art.png", "https://example.org/art.png", "https://s3.amazonaws.com/other/art.png", "/account", "javascript:alert(1)"]) {
        assert.throws(() => compendiumAssetUrl(value, INDEX), /unsupported-asset-origin/);
    }
});

function collectorHarness(overrides = {}) {
    const stored = new Map();
    const requested = [];
    const entryUrl = "https://app.roll20.net/compendium/dnd5e/Example%20Item?expansion=4962";
    const indexUrl = "https://app.roll20.net/compendium/dnd5e/Example%20Book?expansion=4962";
    const routes = {
        [indexUrl]: () => new Response(documentHtml(), { headers: { "content-type": "text/html" } }),
        [entryUrl]: () => new Response(documentHtml({ title: "Example Item", pageId: "456", content: '<p>Entry</p><a href="/compendium/dnd5e/Unrelated">Reference only</a>' }), { headers: { "content-type": "text/html" } }),
        "https://files.d20.io/images/portrait.png": () => new Response("image bytes", { headers: { "content-type": "image/png" } }),
    };
    const collector = new R20CompendiumCollector({
        intervalMs: 0, parseHtml, version: "test", validateImage: async () => undefined,
        store: async (path, blob) => stored.set(path, blob),
        fetch: async (url, options) => {
            requested.push({ url, credentials: options.credentials, redirect: options.redirect });
            assert.ok(routes[url], "unexpected request: " + url);
            return routes[url](options);
        },
        ...overrides,
    });
    return { collector, stored, requested, routes, entryUrl, indexUrl };
}

test("collector captures the frozen scope, deduplicates art and hashes actual stored bytes", async () => {
    const harness = collectorHarness();
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "complete-within-index");
    assert.deepEqual(result.report.pages, { planned: 2, captured: 2, failed: 0, cancelled: 0 });
    assert.equal(result.report.assets.bundled, 1);
    assert.equal(result.manifest.assets[0].references.length, 2);
    assert.equal(harness.requested.length, 3);
    assert.ok(harness.requested.every(row => row.redirect === "error"));
    assert.equal(harness.requested[0].credentials, "same-origin");
    assert.equal(harness.requested[2].credentials, "omit");
    assert.ok(!harness.requested.some(row => row.url.includes("Unrelated")));
    for (const file of result.manifest.pages.flatMap(page => page.files).concat(result.manifest.assets)) {
        const blob = harness.stored.get(file.path);
        assert.equal(blob.size, file.bytes);
        const digest = require("node:crypto").createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");
        assert.equal(digest, file.sha256);
        assert.doesNotMatch(await blob.text(), /PRIVATE_.*_SENTINEL/);
    }
});

test("collector reports a missing entry and never retries a denied page", async () => {
    const harness = collectorHarness();
    harness.routes[harness.entryUrl] = () => new Response("denied", { status: 403 });
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "partial");
    assert.equal(result.report.pages.failed, 1);
    assert.equal(result.manifest.pages[1].reason, "http-403");
    assert.equal(harness.requested.filter(row => row.url === harness.entryUrl).length, 1);
});

test("collector discovers nested source-tagged catalogues and native book navigation", async () => {
    const harness = collectorHarness();
    const appendix = "https://app.roll20.net/compendium/dnd5e/Rules:Bestiary?expansion=4962";
    const alias = "https://app.roll20.net/compendium/dnd5e/Rules:Example%20Book?expansion=4962";
    const rootHtml = documentHtml({ content: '<h3>Appendices</h3><a href="https://roll20.net/compendium/dnd5e/Rules:Bestiary?expansion=4962">Bestiary</a>' });
    const asHtml = html => () => new Response(html, { headers: { "content-type": "text/html" } });
    harness.routes[harness.indexUrl] = asHtml(rootHtml);
    harness.routes[alias] = asHtml(rootHtml);
    harness.routes[appendix] = asHtml(documentHtml({ title: "Bestiary", pageId: "789", content:
        '<a href="/compendium/dnd5e/Example%20Item?expansion=4962">Example Item</a>' +
        '<a href="/compendium/dnd5e/Unrelated">Unscoped reference</a>' +
        '<a href="/compendium/dnd5e/Other%20Book?expansion=9999">Other book</a>',
    }).replace("</body>", '<div class="content-text page-links"><div class="pull-left"><a href="https://roll20.net/compendium/dnd5e/Rules:Example%20Book?expansion=4962" title="Example Book">Previous Page</a></div></div></body>'));
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "complete-within-index");
    assert.equal(result.manifest.scope, "selected-book-catalogue-and-navigation");
    assert.equal(result.report.pages.captured, 3);
    assert.equal(result.report.discovery.pageRequests, 4);
    assert.equal(result.manifest.requestAliases.length, 1);
    assert.equal(result.manifest.requestAliases[0].canonicalRequestUrl, harness.indexUrl);
    assert.equal(result.manifest.pages.find(page => page.requestUrl === harness.entryUrl).links[0].relation, "catalogue");
    assert.ok(!harness.requested.some(row => /Unrelated|Other%20Book/.test(row.url)));
    assert.equal(harness.requested.filter(row => row.url === appendix).length, 1);
});

test("ordinary attribute entries cannot expand the catalogue through their body references", async () => {
    const harness = collectorHarness();
    harness.routes[harness.entryUrl] = () => new Response(documentHtml({ title: "Example Item", pageId: "456",
        content: '<a href="/compendium/dnd5e/Unrelated?expansion=4962">Not a catalogue child</a>',
        attributes: '<div class="attrListItem"><span class="attrName">HP</span><span class="attrValue">12</span></div>',
    }), { headers: { "content-type": "text/html" } });
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.pages.captured, 2);
    assert.ok(!harness.requested.some(row => row.url.includes("Unrelated")));
});

test("discovery limits apply when nested catalogue pages add more work", async () => {
    const harness = collectorHarness({ maxPages: 2 });
    harness.routes[harness.entryUrl] = () => new Response(documentHtml({ title: "Bestiary", pageId: "456",
        content: '<a href="/compendium/dnd5e/Extra?expansion=4962">Extra</a>',
    }), { headers: { "content-type": "text/html" } });
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "failed");
    assert.deepEqual(result.report.issues, ["page-count-limit"]);
    assert.ok(!harness.requested.some(row => row.url.includes("Extra")));
});

test("a native Credits link does not silently excuse the broken source link", async () => {
    const harness = collectorHarness();
    const credits = "https://app.roll20.net/compendium/dnd5e/Rules:Credits%20(Book)?expansion=4962";
    harness.routes[harness.indexUrl] = () => new Response(documentHtml().replace("</body>",
        '<div class="page-links"><a title="Credits (Book)" href="https://roll20.net/compendium/dnd5e/Rules:Credits%20(Book)?expansion=4962">Next Page</a></div></body>'), { headers: { "content-type": "text/html" } });
    harness.routes[harness.entryUrl] = () => new Response("missing", { status: 404 });
    harness.routes[credits] = () => new Response(documentHtml({ title: "Credits (Book)", pageId: "789", content: "Credits text" }), { headers: { "content-type": "text/html" } });
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "partial");
    assert.equal(result.report.pages.captured, 2);
    assert.equal(result.report.pages.failed, 1);
    assert.equal(result.manifest.pages.find(page => page.requestUrl === credits).outcome, "captured");
    assert.equal(result.manifest.pages.find(page => page.requestUrl === harness.entryUrl).reason, "http-404");
});

test("same-page aliases with differing content fail rather than discarding values", async () => {
    const harness = collectorHarness();
    harness.routes[harness.entryUrl] = () => new Response(documentHtml({ title: "Alias", pageId: "123", content: "Different content" }), { headers: { "content-type": "text/html" } });
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "failed");
    assert.deepEqual(result.report.issues, ["conflicting-page-alias"]);
    assert.equal(result.manifest.requestAliases.length, 0);
});

test("collector does not count a login page or another expansion as captured", async () => {
    for (const html of ['<form><input type="password"></form>', documentHtml({ expansion: "9999" })]) {
        const harness = collectorHarness();
        harness.routes[harness.entryUrl] = () => new Response(html, { headers: { "content-type": "text/html" } });
        const result = await harness.collector.collect(INDEX, "4962");
        assert.equal(result.report.status, "partial");
        assert.equal(result.report.pages.captured, 1);
        assert.equal(result.manifest.pages[1].files, undefined);
    }
});

test("collector honors a transient retry and records every attempt", async () => {
    const harness = collectorHarness();
    const original = harness.routes[harness.entryUrl];
    let calls = 0;
    harness.routes[harness.entryUrl] = () => ++calls === 1
        ? new Response("busy", { status: 429, headers: { "retry-after": "0" } }) : original();
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "complete-within-index");
    assert.deepEqual(result.manifest.pages[1].attempts.map(attempt => attempt.status), [429, 200]);
});

test("the request deadline includes a stalled response body", async () => {
    const harness = collectorHarness({ timeoutMs: 30, maxAttempts: 1 });
    harness.routes[harness.entryUrl] = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([60])); } }),
        { headers: { "content-type": "text/html" } });
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "partial");
    assert.equal(result.manifest.pages[1].reason, "request-timeout");
});

test("cancelling the collector prevents remaining page and asset requests", async () => {
    const controller = new AbortController();
    const harness = collectorHarness({ signal: controller.signal,
        onProgress: progress => { if (progress.phase === "pages") controller.abort(); },
    });
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "cancelled");
    assert.equal(harness.requested.length, 1);
    assert.equal(result.report.pages.cancelled, 1);
    assert.equal(result.report.assets.cancelled, 1);
    assert.ok([...result.manifest.pages, ...result.manifest.assets].every(record => record.outcome !== "pending"));
});

test("archive insertion failure is fatal and never reports a captured page", async () => {
    const harness = collectorHarness({ store: async () => { throw new Error("disk full"); } });
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "failed");
    assert.equal(result.report.pages.captured, 0);
    assert.deepEqual(result.report.issues, ["archive-write-failed"]);
    assert.equal(harness.requested.length, 1);
});

test("invalid HTTP 200 image data is missing rather than silently bundled", async () => {
    const harness = collectorHarness({ validateImage: async () => { throw new Error("decode failure"); } });
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "partial");
    assert.equal(result.report.assets.bundled, 0);
    assert.equal(result.manifest.assets[0].reason, "invalid-image");
    assert.equal(result.manifest.assets[0].attempts.length, 1);
});

test("body size limits apply even without an honest Content-Length", async () => {
    const harness = collectorHarness({ maxPageBytes: 2048 });
    harness.routes[harness.entryUrl] = () => new Response("x".repeat(4096), { headers: { "content-type": "text/html", "content-length": "1" } });
    const result = await harness.collector.collect(INDEX, "4962");
    assert.equal(result.report.status, "partial");
    assert.equal(result.manifest.pages[1].reason, "response-size-limit");
});

test("a book index must be nonempty and within its declared page budget", async () => {
    const empty = collectorHarness();
    empty.routes[empty.indexUrl] = () => new Response(documentHtml({ content: "No linked entries" }), { headers: { "content-type": "text/html" } });
    const emptyResult = await empty.collector.collect(INDEX, "4962");
    assert.equal(emptyResult.report.status, "failed");
    assert.deepEqual(emptyResult.report.issues, ["empty-book-index"]);
    const limited = collectorHarness({ maxPages: 1 });
    const limitedResult = await limited.collector.collect(INDEX, "4962");
    assert.equal(limitedResult.report.status, "failed");
    assert.deepEqual(limitedResult.report.issues, ["page-count-limit"]);
    assert.equal(limited.requested.length, 1);
});

test("unsafe index URLs are rejected before making a request", async () => {
    const harness = collectorHarness();
    await assert.rejects(() => harness.collector.collect("https://example.org/compendium/dnd5e/Book", "4962"), /outside-selected-compendium/);
    assert.equal(harness.requested.length, 0);
});

function uiHarness(options = {}) {
    const window = new JSDOM(documentHtml(), { url: INDEX }).window;
    windows.push(window);
    const harness = collectorHarness();
    const members = new Map();
    let delivered = 0;
    let writes = 0;
    const folder = prefix => ({
        addDirectory: name => folder(prefix + name + "/"),
        addBlob: (name, blob) => members.set(prefix + name, blob),
    });
    const instance = mount(window.document, {
        createZip: () => folder(""),
        createCollector: settings => {
            Object.assign(harness.collector, settings);
            return harness.collector;
        },
        archive: {
            openDestination: async () => ({ writable: {}, deliver: () => { delivered++; }, abort: async () => undefined }),
            exportZip: async () => { writes++; },
        },
        terminateWorkers: () => undefined,
        saveAs: () => undefined,
        ...options,
    });
    return { ...harness, window, instance, members, delivered: () => delivered, writes: () => writes };
}

test("compendium UI is idle until explicitly started and preserves campaign separation", async () => {
    const harness = uiHarness();
    assert.ok(harness.instance);
    assert.equal(harness.requested.length, 0);
    assert.equal(mount(harness.window.document), null);
    const result = await harness.instance.exportZip({ usePicker: false });
    assert.equal(result.report.status, "complete-within-index");
    assert.equal(harness.delivered(), 1);
    assert.equal(harness.writes(), 1);
    assert.ok(harness.members.has("compendium.json"));
    assert.ok(harness.members.has("export_report.json"));
    assert.ok(!harness.members.has("campaign.json"));
    assert.equal(harness.window.document.querySelector('[role="status"]').textContent, "Export saved: 2 pages, 1 image");
    assert.equal(harness.window.document.querySelector(".r20compendium-count").textContent, "2 captured pages");
});

test("the compendium save picker is acquired before network work", async () => {
    let pickerCalls = 0;
    const harness = uiHarness({ picker: async () => { pickerCalls++; assert.equal(harness.requested.length, 0); return {}; } });
    await harness.instance.exportZip();
    assert.equal(pickerCalls, 1);
    assert.equal(harness.delivered(), 1);
});

test("cancelling the compendium picker starts no requests and delivers no ZIP", async () => {
    const harness = uiHarness({ picker: async () => { throw new DOMException("Cancelled", "AbortError"); } });
    const result = await harness.instance.exportZip();
    assert.equal(result.report.status, "cancelled");
    assert.equal(harness.requested.length, 0);
    assert.equal(harness.delivered(), 0);
    assert.equal(harness.instance.running, false);
});

test("a failed capture never triggers ZIP delivery", async () => {
    const harness = uiHarness();
    harness.routes[harness.indexUrl] = () => new Response("login", { headers: { "content-type": "text/html" } });
    const result = await harness.instance.exportZip({ usePicker: false });
    assert.equal(result.report.status, "failed");
    assert.equal(harness.delivered(), 0);
    assert.equal(harness.writes(), 0);
});

test("ZIP write errors remain failures and enable the diagnostic report", async () => {
    let aborted = 0;
    const harness = uiHarness({ archive: {
        openDestination: async () => ({ writable: {}, deliver: () => assert.fail("must not deliver"), abort: async () => { aborted++; } }),
        exportZip: async () => { throw new Error("disk full"); },
    } });
    const result = await harness.instance.exportZip({ usePicker: false });
    assert.equal(result.report.status, "failed");
    assert.equal(result.report.capture_status, "complete-within-index");
    assert.equal(aborted, 1);
    assert.match(harness.window.document.querySelector('[role="status"]').textContent, /Export failed/);
    assert.equal(harness.window.document.querySelectorAll("button")[2].disabled, false);
});