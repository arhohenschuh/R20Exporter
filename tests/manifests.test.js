"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    R20ExportReport,
    OUTCOME,
    buildIndex,
    buildIntegrity,
    detectCharacterSheet,
    exportedCollectionCounts,
    liveCollectionCounts,
    compareCollectionCounts,
    checkEngineGlobals,
    countChatMessages,
} = require("../src/R20ExportManifests.js");

const NOW = () => "1980-01-01T00:00:00.000Z";

function campaign(overrides = {}) {
    return Object.assign(
        {
            campaign_id: 42,
            campaign_title: "Test",
            release: "jumpgate",
            characters: [{ id: "c1", name: "Erky", bio: "", gmnotes: "", attributes: [] }],
            handouts: [{ id: "h1", name: "Rumours", notes: "", gmnotes: "" }],
            pdfs: [],
            pages: [{ id: "p1", name: "Level 1", graphics: [], paths: [], texts: [], thumbnail: "" }],
            players: [{ id: "pl1", displayname: "GM" }],
            macros: [{ id: "m1", name: "Perception" }],
            decks: [],
            tables: [],
            jukebox: [],
            journalfolder: ["h1", "c1"],
            jukeboxfolder: [],
            chat_archive: [],
        },
        overrides
    );
}

test("the report counts each outcome and keeps failures visible", () => {
    const report = new R20ExportReport({ now: NOW });
    const good = report.beginAsset("https://files.d20.io/images/a/med.png", "pages/1/graphics/a");
    report.succeeded(good, { outcome: OUTCOME.BUNDLED, bytes: 10, variant: "original" });
    const lower = report.beginAsset("https://files.d20.io/images/b/med.png", "pages/1/graphics/b");
    report.succeeded(lower, { outcome: OUTCOME.LOWER_RES, bytes: 5, variant: "med" });
    const dead = report.beginAsset("https://files.d20.io/images/c/med.png", "pages/1/graphics/c");
    report.attempted(dead, "https://files.d20.io/images/c/original.png", 404);
    report.failed(dead, { reason: "gone", status: 404 });
    const never = report.beginAsset("https://files.d20.io/images/d/med.png", "pages/1/graphics/d");

    assert.equal(report.totals.assets, 4);
    assert.equal(report.totals.bundled, 1);
    assert.equal(report.totals["bundled-lower-res"], 1);
    assert.equal(report.totals.failed, 1);
    assert.equal(report.totals.pending, 1);
    assert.equal(report.totals.bytes, 15);
    // A record nobody ever resolved is a miss too, not a success.
    assert.deepEqual(report.failures.map((a) => a.path).sort(), [never.path, dead.path].sort());
});

test("the report is ordered so two exports only differ in volatile fields", () => {
    const report = new R20ExportReport({ now: NOW });
    report.succeeded(report.beginAsset("u3", "z/c"), {});
    report.succeeded(report.beginAsset("u1", "a/a"), {});
    report.succeeded(report.beginAsset("u2", "m/b"), {});
    assert.deepEqual(report.toJSON().assets.map((a) => a.path), ["a/a", "m/b", "z/c"]);
});

test("exported counts are compared against the live page, and a gap is reported", () => {
    const exported = exportedCollectionCounts(campaign());
    assert.equal(exported.characters, 1);
    assert.equal(exported.macros, 1);
    assert.equal(exported.graphics, 0);

    const live = { characters: 2, handouts: 1, macros: null };
    const mismatches = compareCollectionCounts(exported, live);
    assert.deepEqual(mismatches, [{ collection: "characters", exported: 1, live: 2 }]);
});

test("a collection the page does not expose counts as null, never as zero", () => {
    const counts = liveCollectionCounts({
        Campaign: {
            characters: { models: [1, 2] },
            handouts: { models: [] },
            pages: { models: [{ thegraphics: { length: 3 }, thepaths: { length: 1 }, thetexts: { length: 0 } }] },
            players: { models: [{ macros: { length: 2 } }] },
        },
    });
    assert.equal(counts.characters, 2);
    assert.equal(counts.graphics, 3);
    assert.equal(counts.macros, 2);
    assert.equal(counts.pdfs, null);
    assert.equal(counts.jukebox, null);
});

test("the engine guard fails loudly on a page it does not understand", () => {
    const ok = checkEngineGlobals({
        Campaign: {
            toJSON: () => ({}),
            characters: { models: [] },
            handouts: { models: [] },
            pages: { models: [{ id: "p1" }] },
            players: { models: [] },
        },
        BackboneFirebase: function () {},
        campaign_id: 1,
        d20_account_id: 2,
        is_gm: true,
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.degraded.map((d) => d.path).sort(), [
        "Campaign.decks.models",
        "Campaign.pdfs.models",
        "Campaign.rollabletables.models",
        "Jukebox.playlist",
    ]);

    const renamed = checkEngineGlobals({ Campaign: undefined, BackboneFirebase: undefined });
    assert.equal(renamed.ok, false);
    assert.ok(renamed.missing.some((m) => m.path === "Campaign"));
    assert.ok(renamed.missing.some((m) => m.path === "BackboneFirebase"));
});

test("integrity finds a token whose character was deleted", () => {
    const manifest = buildIntegrity(
        campaign({
            pages: [
                {
                    id: "p1",
                    name: "Level 1",
                    thumbnail: "",
                    texts: [],
                    paths: [],
                    graphics: [
                        { id: "g1", represents: "c1" },
                        { id: "g2", represents: "deleted-character" },
                        { id: "g3", represents: "" },
                    ],
                },
            ],
        }),
        { now: NOW }
    );
    const dangling = manifest.findings.filter((f) => f.kind === "dangling-token-represents");
    assert.equal(dangling.length, 1);
    assert.equal(dangling[0].graphic_id, "g2");
    assert.equal(dangling[0].represents, "deleted-character");
    assert.equal(manifest.totals["dangling-token-represents"], 1);
});

test("integrity flags a page that exported empty but still has a thumbnail", () => {
    const manifest = buildIntegrity(
        campaign({
            pages: [{ id: "p1", name: "Level 1", graphics: [], paths: [], texts: [], thumbnail: "https://files.d20.io/images/t/med.png" }],
        }),
        { now: NOW }
    );
    assert.equal(manifest.totals["empty-page-with-thumbnail"], 1);
});

test("integrity flags links and folder entries that point at nothing", () => {
    const manifest = buildIntegrity(
        campaign({
            handouts: [
                {
                    id: "h1",
                    name: "Rumours",
                    notes: '<a href="https://journal.roll20.net/character/-GONE12345">x</a> and '
                        + "[Erky](https://journal.roll20.net/character/c1)",
                    gmnotes: "",
                },
            ],
            journalfolder: ["h1", "c1", "-NOTHERE9999"],
        }),
        { now: NOW }
    );
    const links = manifest.findings.filter((f) => f.kind === "dangling-journal-link");
    assert.equal(links.length, 1);
    assert.equal(links[0].target_id, "-GONE12345");
    assert.equal(manifest.totals["dangling-folder-entry"], 1);
});

test("integrity flags an unusable roll payload without repairing it", () => {
    const archive = [
        {
            good: { type: "rollresult", origRoll: "1d20", content: '{"total":7}' },
            bad: { type: "rollresult", origRoll: "1d20", content: "" },
            worse: { type: "gmrollresult", origRoll: "", content: '{"total":7}' },
            chat: { type: "general", content: "hi" },
        },
    ];
    const manifest = buildIntegrity(campaign({ chat_archive: archive }), { now: NOW });
    assert.equal(manifest.totals["unusable-chat-roll"], 2);
    assert.equal(countChatMessages(archive), 4);
    assert.equal(archive[0].bad.content, "", "the manifest must not touch the payload");
});

test("the index maps every linkable id to its type and name", () => {
    const index = buildIndex(campaign(), { now: NOW });
    assert.equal(index.entries.c1.type, "character");
    assert.equal(index.entries.c1.name, "Erky");
    assert.equal(index.entries.h1.type, "handout");
    assert.equal(index.entries.m1.type, "macro");
    assert.equal(index.count, 5);
    assert.deepEqual(Object.keys(index.entries), Object.keys(index.entries).slice().sort());
});

// Downstream flattened 5,108 journal entries into one folder and every count still
// matched, so the tree itself has to be recorded, not just the documents in it.
const NESTED = [
    { n: "Part 1", i: ["h1", { n: "Handouts", i: ["h2"] }] },
    { n: "Part 2", i: [] },
    "c1",
];

test("the index records the folder path of every document", () => {
    const index = buildIndex(campaign({
        journalfolder: NESTED,
        handouts: [{ id: "h1", name: "Rumours" }, { id: "h2", name: "Map" }],
    }), { now: NOW });
    assert.equal(index.entries.h1.folder, "Part 1");
    assert.equal(index.entries.h2.folder, "Part 1/Handouts");
    assert.equal(index.entries.c1.folder, null, "a document at the root has no folder");
    assert.equal(index.entries.p1.folder, null, "pages have no Roll20 folders at all");
});

test("the index records the shape of the folder tree, not just its contents", () => {
    const { folders } = buildIndex(campaign({
        journalfolder: NESTED,
        handouts: [{ id: "h1", name: "Rumours" }, { id: "h2", name: "Map" }],
    }), { now: NOW });
    assert.deepEqual(folders.journal.paths, ["Part 1", "Part 1/Handouts", "Part 2"]);
    assert.equal(folders.journal.folders, 3);
    assert.equal(folders.journal.max_depth, 2);
    assert.equal(folders.journal.documents_in_folders, 2);
    assert.equal(folders.journal.documents_at_root, 1);
    assert.equal(folders.journal.duplicate_paths.length, 0);
    assert.equal(folders.journal.folders, 3, "an empty branch is still a folder");
});

test("two sibling folders sharing a name are reported, not collapsed", () => {
    const { folders } = buildIndex(campaign({
        journalfolder: [{ n: "Maps", i: ["h1"] }, { n: "Maps", i: [] }],
    }), { now: NOW });
    assert.equal(folders.journal.folders, 2);
    assert.deepEqual(folders.journal.duplicate_paths, ["Maps"]);
});

test("a stored name Foundry cannot draw is flagged rather than renamed", () => {
    const report = new R20ExportReport({ now: NOW });
    // The exporter keeps the URL's extension on purpose (ADR-003) -- 139 such
    // members exist across the archived exports -- so it has to say so.
    const bad = report.beginAsset("https://files.d20.io/images/a/original.svg&cb=5", "pages/1/graphics/a");
    report.succeeded(bad, { path: "pages/1/graphics/a.svg&cb=5", bytes: 1 });
    const jfif = report.beginAsset("https://files.d20.io/images/b/med.jfif", "pages/1/graphics/b");
    report.succeeded(jfif, { path: "pages/1/graphics/b.jfif", bytes: 1 });
    const fine = report.beginAsset("https://files.d20.io/images/c/original.webp", "pages/1/graphics/c");
    report.succeeded(fine, { path: "pages/1/graphics/c.webp", bytes: 1 });

    assert.equal(bad.renderable, false);
    assert.equal(jfif.renderable, false);
    assert.equal(fine.renderable, true);
    assert.equal(report.totals["not-renderable"], 2);
    assert.equal(report.toJSON().assets.find((a) => a.path.endsWith(".webp")).renderable, true);
});

test("the character sheet template is recorded, or honestly reported as unknown", () => {
    assert.deepEqual(detectCharacterSheet(campaign(), { CharacterSheetsManagerSingleton: { sheets: { ogl5e: {} } } }), {
        template: "ogl5e",
        templates: ["ogl5e"],
        source: "page.CharacterSheetsManagerSingleton.sheets",
    });
    assert.deepEqual(detectCharacterSheet(campaign({ charsheettype: "OGL_2.0" })), {
        template: "OGL_2.0",
        templates: ["OGL_2.0"],
        source: "campaign.charsheettype",
    });
    assert.deepEqual(
        detectCharacterSheet(campaign({ characters: [{ id: "c1", attributes: [{ name: "character_sheet", current: "Shaped_5e" }] }] })),
        { template: "Shaped_5e", templates: ["Shaped_5e"], source: "character-attribute:character_sheet" }
    );
    assert.deepEqual(detectCharacterSheet(campaign()), { template: null, templates: [], source: "unavailable" });
});
