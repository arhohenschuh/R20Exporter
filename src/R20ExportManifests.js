"use strict";

// Sidecar manifests for an export: the report, the integrity findings and the
// reference index, plus the guards that decide whether an export is trustworthy.
//
// ADR-001: nothing here ever changes a Roll20-sourced field. Everything is
// additional information a consumer may ignore.
// ADR-002: plain functions over plain data so the same code runs in the Roll20
// page and in `node --test`.
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        for (const key of Object.keys(api)) {
            root[key] = api[key];
        }
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {

// Kept in step with manifest.json by tests/version.test.js. The page context
// has no access to chrome.runtime, so the version cannot be read at runtime.
const R20EXPORTER_VERSION = "1.3.1";

const REPORT_FORMAT = "1.3";
const INTEGRITY_FORMAT = "1.0";
const INDEX_FORMAT = "1.3";

const OUTCOME = {
    PENDING: "pending",
    BUNDLED: "bundled",
    LOWER_RES: "bundled-lower-res",
    CANVAS: "canvas-reencoded",
    FAILED: "failed",
    SKIPPED: "skipped",
};

// Foundry silently refuses to draw a path whose extension is not one of these
// (CONST.IMAGE_FILE_EXTENSIONS / VIDEO_ / AUDIO_). We deliberately keep the name
// the source URL advertises -- ADR-003, because the converter looks the member up
// by it -- so the honest thing is to say so rather than rename the file.
const RENDERABLE_EXTENSIONS = new Set([
    "apng", "avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "tiff", "webp",
    "m4v", "mp4", "ogv", "webm",
    "aac", "flac", "m4a", "mid", "mp3", "ogg", "opus", "wav",
]);

function _isRenderablePath(path) {
    const name = _text(path).split("/").pop();
    const dot = name.lastIndexOf(".");
    if (dot < 0) return false;
    return RENDERABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function _array(value) {
    return Array.isArray(value) ? value : [];
}

function _text(value) {
    return typeof value === "string" ? value : "";
}

function _get(scope, path) {
    let current = scope;
    for (const part of path.split(".")) {
        if (current === undefined || current === null) return undefined;
        current = current[part];
    }
    return current;
}

// --- the report -------------------------------------------------------------

class R20ExportReport {
    constructor(options = {}) {
        this.exporterVersion = options.version || R20EXPORTER_VERSION;
        this.now = options.now || (() => new Date().toISOString());
        this.campaign = { id: null, title: null, release: null };
        this.characterSheet = { template: null, templates: [], source: "unavailable" };
        this.characterSheets = [];
        this.characterAttributes = { total: 0, loaded: 0, incomplete: [] };
        this.folderOrphansAppended = {};
        this.assets = [];
        this.collections = {};
        this.collectionMismatches = [];
        this.notes = [];
    }

    setCampaign(campaign) {
        this.campaign = {
            id: campaign.campaign_id !== undefined ? campaign.campaign_id : null,
            title: campaign.campaign_title !== undefined ? campaign.campaign_title : null,
            release: campaign.release !== undefined ? campaign.release : "legacy",
        };
    }

    note(message) {
        this.notes.push(String(message));
    }

    beginAsset(url, path, kind = "image") {
        const record = {
            path: _text(path),
            url: _text(url),
            kind: kind,
            outcome: OUTCOME.PENDING,
            served_from: null,
            variant: null,
            bytes: null,
            sha256: null,
            content_type: null,
            renderable: null,
            reason: null,
            status: null,
            attempts: [],
        };
        this.assets.push(record);
        return record;
    }

    attempted(record, url, status = null, error = null) {
        if (!record) return;
        record.attempts.push({ url: _text(url), status: status, error: error ? String(error) : null });
    }

    succeeded(record, details = {}) {
        if (!record) return;
        record.outcome = details.outcome || OUTCOME.BUNDLED;
        record.served_from = details.servedFrom !== undefined ? details.servedFrom : record.served_from;
        record.variant = details.variant !== undefined ? details.variant : record.variant;
        record.bytes = details.bytes !== undefined ? details.bytes : record.bytes;
        record.sha256 = details.sha256 !== undefined ? details.sha256 : record.sha256;
        record.content_type = details.contentType !== undefined ? details.contentType : record.content_type;
        record.path = details.path !== undefined ? details.path : record.path;
        record.renderable = _isRenderablePath(record.path);
        record.reason = null;
        record.status = null;
    }

    failed(record, details = {}) {
        if (!record) return;
        record.outcome = OUTCOME.FAILED;
        record.reason = details.reason !== undefined ? details.reason : record.reason;
        record.status = details.status !== undefined ? details.status : record.status;
    }

    skipped(record, reason) {
        if (!record) return;
        record.outcome = OUTCOME.SKIPPED;
        record.reason = reason;
    }

    get totals() {
        const totals = {
            assets: this.assets.length,
            bundled: 0,
            "bundled-lower-res": 0,
            "canvas-reencoded": 0,
            failed: 0,
            skipped: 0,
            pending: 0,
            "not-renderable": 0,
            bytes: 0,
        };
        for (const asset of this.assets) {
            if (totals[asset.outcome] !== undefined) totals[asset.outcome] += 1;
            if (asset.renderable === false) totals["not-renderable"] += 1;
            if (typeof asset.bytes === "number") totals.bytes += asset.bytes;
        }
        return totals;
    }

    get failures() {
        return this.assets.filter((a) => a.outcome === OUTCOME.FAILED || a.outcome === OUTCOME.PENDING);
    }

    setCollectionCounts(exported, live) {
        this.collections = {};
        this.collectionMismatches = compareCollectionCounts(exported, live);
        for (const name of Object.keys(exported).sort()) {
            this.collections[name] = {
                exported: exported[name],
                live: live && live[name] !== undefined ? live[name] : null,
            };
        }
    }

    toJSON() {
        // Sorted so two exports of an unchanged campaign differ only in the
        // fields listed in tools/volatile-fields.json.
        const assets = this.assets.slice().sort((a, b) => {
            if (a.path !== b.path) return a.path < b.path ? -1 : 1;
            return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
        });
        return {
            R20Exporter_report_format: REPORT_FORMAT,
            exporter_version: this.exporterVersion,
            generated_at: this.now(),
            campaign: this.campaign,
            character_sheet: this.characterSheet,
            character_sheets: this.characterSheets,
            character_attributes: this.characterAttributes,
            folder_orphans_appended: this.folderOrphansAppended,
            totals: this.totals,
            collections: this.collections,
            collection_mismatches: this.collectionMismatches,
            notes: this.notes.slice().sort(),
            assets: assets,
        };
    }
}

// --- collection counting ----------------------------------------------------

const COLLECTION_SOURCES = [
    { name: "characters", exported: "characters", live: "Campaign.characters.models" },
    { name: "handouts", exported: "handouts", live: "Campaign.handouts.models" },
    { name: "pdfs", exported: "pdfs", live: "Campaign.pdfs.models" },
    { name: "pages", exported: "pages", live: "Campaign.pages.models" },
    { name: "players", exported: "players", live: "Campaign.players.models" },
    { name: "decks", exported: "decks", live: "Campaign.decks.models" },
    { name: "tables", exported: "tables", live: "Campaign.rollabletables.models" },
    { name: "jukebox", exported: "jukebox", live: "Jukebox.playlist.models" },
];

function exportedCollectionCounts(campaign) {
    const counts = {};
    for (const source of COLLECTION_SOURCES) {
        counts[source.name] = _array(campaign[source.exported]).length;
    }
    counts.macros = _array(campaign.macros).length;
    let graphics = 0;
    let paths = 0;
    let texts = 0;
    for (const page of _array(campaign.pages)) {
        graphics += _array(page.graphics).length;
        paths += _array(page.paths).length;
        texts += _array(page.texts).length;
    }
    counts.graphics = graphics;
    counts.paths = paths;
    counts.texts = texts;
    counts.chat_messages = countChatMessages(campaign.chat_archive);
    return counts;
}

function countChatMessages(archive) {
    let total = 0;
    for (const group of _array(archive)) {
        if (group && typeof group === "object") total += Object.keys(group).length;
    }
    return total;
}

// A collection the page does not expose counts as null -- "not comparable" --
// rather than 0, which would read as "we exported everything".
function liveCollectionCounts(scope) {
    const counts = {};
    for (const source of COLLECTION_SOURCES) {
        const models = _get(scope, source.live);
        counts[source.name] = Array.isArray(models) ? models.length : null;
    }
    const players = _get(scope, "Campaign.players.models");
    counts.macros = Array.isArray(players)
        ? players.reduce((sum, p) => sum + (p.macros && p.macros.length ? p.macros.length : 0), 0)
        : null;
    const pages = _get(scope, "Campaign.pages.models");
    if (Array.isArray(pages)) {
        let graphics = 0;
        let paths = 0;
        let texts = 0;
        for (const page of pages) {
            graphics += page.thegraphics ? page.thegraphics.length : 0;
            paths += page.thepaths ? page.thepaths.length : 0;
            texts += page.thetexts ? page.thetexts.length : 0;
        }
        counts.graphics = graphics;
        counts.paths = paths;
        counts.texts = texts;
    } else {
        counts.graphics = counts.paths = counts.texts = null;
    }
    counts.chat_messages = null; // the archive is fetched, never enumerated live
    return counts;
}

function compareCollectionCounts(exported, live) {
    const mismatches = [];
    if (!live) return mismatches;
    for (const name of Object.keys(exported).sort()) {
        const liveCount = live[name];
        if (liveCount === null || liveCount === undefined) continue;
        if (liveCount !== exported[name]) {
            mismatches.push({ collection: name, exported: exported[name], live: liveCount });
        }
    }
    return mismatches;
}

// --- the engine guard -------------------------------------------------------

const ENGINE_REQUIREMENTS = [
    { path: "Campaign", test: (v) => v && typeof v.toJSON === "function", why: "the campaign model" },
    { path: "Campaign.characters.models", test: Array.isArray, why: "characters" },
    { path: "Campaign.handouts.models", test: Array.isArray, why: "handouts" },
    { path: "Campaign.pages.models", test: Array.isArray, why: "pages" },
    { path: "Campaign.players.models", test: Array.isArray, why: "players" },
    { path: "BackboneFirebase", test: (v) => typeof v === "function", why: "character sheet loading" },
    { path: "campaign_id", test: (v) => v !== undefined && v !== null, why: "the campaign id" },
    { path: "d20_account_id", test: (v) => v !== undefined && v !== null, why: "the account id" },
];

const ENGINE_OPTIONAL = [
    { path: "Campaign.pdfs.models", test: Array.isArray, why: "PDFs" },
    { path: "Campaign.decks.models", test: Array.isArray, why: "decks" },
    { path: "Campaign.rollabletables.models", test: Array.isArray, why: "rollable tables" },
    { path: "Jukebox.playlist", test: (v) => v && typeof v.toJSON === "function", why: "the jukebox" },
    { path: "is_gm", test: (v) => v !== undefined, why: "GM detection" },
];

// Presence is not arrival (B006). Roll20 guarantees a campaign has at least one
// page, so an empty page list means the data has not reached the browser yet --
// and every collection reads a convincing, agreeing zero until it does.
const ENGINE_READINESS = [
    {
        path: "Campaign.pages.models",
        test: (v) => Array.isArray(v) && v.length > 0,
        why: "the campaign has no pages yet, so it is still loading",
    },
];

function checkEngineGlobals(scope) {
    const missing = [];
    const degraded = [];
    const loading = [];
    for (const requirement of ENGINE_REQUIREMENTS) {
        if (!requirement.test(_get(scope, requirement.path))) {
            missing.push({ path: requirement.path, why: requirement.why });
        }
    }
    for (const requirement of ENGINE_OPTIONAL) {
        if (!requirement.test(_get(scope, requirement.path))) {
            degraded.push({ path: requirement.path, why: requirement.why });
        }
    }
    if (missing.length === 0) {
        for (const requirement of ENGINE_READINESS) {
            if (!requirement.test(_get(scope, requirement.path))) {
                loading.push({ path: requirement.path, why: requirement.why });
            }
        }
    }
    return { ok: missing.length === 0 && loading.length === 0, missing: missing, degraded: degraded, loading: loading };
}

function sameCollectionCounts(left, right) {
    if (!left || !right) return false;
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (left[key] !== right[key]) return false;
    }
    return true;
}

// A character whose attribs never arrived exports as a name with no sheet. That
// is a degradation to count, not a reason to fail the run (GH #34).
function characterAttributeSummary(campaign) {
    const incomplete = [];
    const characters = _array(campaign.characters);
    for (const character of characters) {
        if (!character) continue;
        if (_array(character.attributes).length === 0) {
            incomplete.push({ id: _text(character.id), name: _text(character.name) });
        }
    }
    incomplete.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { total: characters.length, loaded: characters.length - incomplete.length, incomplete: incomplete };
}

// --- the reference index ----------------------------------------------------

// Page graphics are deliberately absent: they carry no name, are never the
// target of a journal link, and there are two orders of magnitude more of them
// than of everything else combined. Dangling graphics are reported by the
// integrity manifest instead.
const INDEX_SOURCES = [
    { collection: "characters", type: "character", name: "name" },
    { collection: "handouts", type: "handout", name: "name" },
    { collection: "pdfs", type: "pdf", name: "name" },
    { collection: "pages", type: "page", name: "name" },
    { collection: "jukebox", type: "track", name: "title" },
    { collection: "decks", type: "deck", name: "name" },
    { collection: "tables", type: "table", name: "name" },
    { collection: "players", type: "player", name: "displayname" },
    { collection: "macros", type: "macro", name: "name" },
];

function buildIndex(campaign, options = {}) {
    const now = options.now || (() => new Date().toISOString());
    const folders = buildFolderStructure(campaign);
    const entries = [];
    for (const source of INDEX_SOURCES) {
        for (const item of _array(campaign[source.collection])) {
            if (!item || item.id === undefined || item.id === null) continue;
            const id = String(item.id);
            entries.push([id, {
                type: source.type,
                name: _text(item[source.name]),
                folder: folders.membership[id] !== undefined ? folders.membership[id] : null,
            }]);
        }
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const index = {};
    for (const [id, value] of entries) index[id] = value;
    return {
        R20Exporter_index_format: INDEX_FORMAT,
        generated_at: now(),
        count: entries.length,
        folders: folders.trees,
        scene_barriers: buildSceneBarriers(campaign),
        entries: index,
    };
}

// --- scene barriers ---------------------------------------------------------

// Roll20 has two incompatible ways of saying "door" and the export is the only place
// both are visible. Legacy dynamic lighting has no door object at all -- a door is a
// wall-layer path drawn in a different stroke colour, a convention rather than a field --
// while Jumpgate/UDL pages carry real `doors`. A consumer that guesses wrong either
// loses every door on a legacy page or invents doors on a modern one, and one campaign
// can hold both encodings on different pages.
//
// Recording it here costs nothing and makes the downstream question answerable instead
// of inferred: how many doors should this scene have?
const WALL_LAYER = "walls";
const WALL_BARRIER = "wall";

function _normalizeStroke(value) {
    const token = _text(value).trim().toLowerCase();
    if (token === "transparent") return token;

    const rgb = token.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/);
    if (rgb) {
        const channels = rgb.slice(1, 4).map(Number);
        if (channels.every((channel) => channel >= 0 && channel <= 255)) {
            return "#" + channels.map((channel) => channel.toString(16).padStart(2, "0")).join("");
        }
        return token;
    }

    const hex = token.match(/^#([0-9a-f]{3,8})$/);
    if (!hex) return token;
    const digits = hex[1];
    if (digits.length < 6) return "#" + digits.slice(0, 3).split("").map((c) => c + c).join("");
    return "#" + digits.slice(0, 6);
}

function _segmentCount(path) {
    // Legacy stores a flat "M,39,0,L,0,2" string, Jumpgate a real [["M",x,y]] array,
    // and `points` is usually null. Assuming one form silently counts zero.
    if (Array.isArray(path.path)) return Math.max(0, path.path.length - 1);
    if (Array.isArray(path.points) && path.points.length) return Math.max(0, path.points.length - 1);
    if (typeof path.path === "string") {
        try {
            const parsed = JSON.parse(path.path);
            if (Array.isArray(parsed)) return Math.max(0, parsed.length - 1);
        } catch (e) { /* flat string form */ }
        return Math.max(0, (path.path.match(/[ML]/g) || []).length - 1);
    }
    return 0;
}

function buildSceneBarriers(campaign) {
    const pages = {};
    const totals = {
        pages: 0, native: 0, colour: 0, single_colour: 0, none: 0,
        doors: 0, windows: 0, native_residue_pages: 0, native_residue_segments: 0,
    };
    for (const page of _array(campaign.pages)) {
        if (!page || page.id === undefined || page.id === null) continue;
        const wallPaths = _array(page.paths).filter((p) => p && p.layer === WALL_LAYER);
        const barrierTypes = {};
        const strokes = {};
        const normalizedStrokes = {};
        for (const p of wallPaths) {
            const type = _text(p.barrierType) || "wall";
            barrierTypes[type] = (barrierTypes[type] || 0) + 1;
            // Only a plain barrier can carry a door colour; one-way and transparent
            // barriers are their own thing and the converter excludes them too.
            if (type !== WALL_BARRIER) continue;
            const stroke = _text(p.stroke);
            const count = _segmentCount(p);
            strokes[stroke] = (strokes[stroke] || 0) + count;
            const normalized = _normalizeStroke(stroke);
            normalizedStrokes[normalized] = (normalizedStrokes[normalized] || 0) + count;
        }
        const doors = _array(page.doors).length;
        const windows = _array(page.windows).length;
        const distinct = Object.keys(normalizedStrokes).length;
        const encoding = doors > 0 ? "native"
            : distinct > 1 ? "colour"
                : distinct === 1 ? "single-colour" : "none";
        const nativeResidue = doors > 0
            ? Object.fromEntries(Object.entries(normalizedStrokes).filter(([stroke]) => stroke !== "#0000ff"))
            : null;
        const nativeResidueSegments = nativeResidue
            ? Object.values(nativeResidue).reduce((sum, count) => sum + count, 0) : 0;

        pages[String(page.id)] = {
            name: _text(page.name),
            doors: doors,
            windows: windows,
            wall_paths: wallPaths.length,
            barrier_types: barrierTypes,
            stroke_segments: strokes,
            stroke_segments_normalized: normalizedStrokes,
            stroke_scope: { layer: WALL_LAYER, barrierType: WALL_BARRIER },
            native_colour_residue: nativeResidue,
            door_encoding: encoding,
            // Roll20's own UDL migration can delete the legacy layer outright, so a page
            // that once held colour-coded doors comes back with none. Flagged, never
            // repaired -- the older export may be the only surviving copy.
            udl_auto_converted: page.udl_auto_converted === true,
        };
        totals.pages += 1;
        totals[encoding.replace("-", "_")] += 1;
        totals.doors += doors;
        totals.windows += windows;
        if (nativeResidueSegments > 0) {
            totals.native_residue_pages += 1;
            totals.native_residue_segments += nativeResidueSegments;
        }
    }
    return { totals, pages };
}

// --- the folder structure ---------------------------------------------------
// Preserving every document is not the same as preserving the campaign: a
// consumer can rebuild all 5,108 journal entries into one flat list and every
// count still matches. The tree is therefore recorded explicitly so downstream
// can assert structure rather than totals.
const FOLDER_SOURCES = [
    { name: "journal", field: "journalfolder" },
    { name: "jukebox", field: "jukeboxfolder" },
];

function _walkFolder(nodes, prefix, out) {
    for (const entry of _array(nodes)) {
        if (typeof entry === "string") {
            out.membership[entry] = prefix;
            if (prefix !== null) out.documents += 1;
            else out.root_documents += 1;
            continue;
        }
        if (!entry || typeof entry !== "object") continue;
        const name = _text(entry.n);
        const path = prefix === null ? name : prefix + "/" + name;
        out.paths.push(path);
        out.max_depth = Math.max(out.max_depth, path.split("/").length);
        _walkFolder(entry.i, path, out);
    }
}

function buildFolderStructure(campaign) {
    const trees = {};
    const membership = {};
    for (const source of FOLDER_SOURCES) {
        const out = { paths: [], membership: {}, documents: 0, root_documents: 0, max_depth: 0 };
        _walkFolder(campaign[source.field], null, out);
        // Roll20 permits two sibling folders with the same name, so a duplicate
        // path is a real campaign shape, not a bug -- report it, do not collapse it.
        const seen = new Set();
        const duplicates = [];
        for (const path of out.paths) {
            if (seen.has(path)) duplicates.push(path);
            seen.add(path);
        }
        trees[source.name] = {
            folders: out.paths.length,
            max_depth: out.max_depth,
            documents_in_folders: out.documents,
            documents_at_root: out.root_documents,
            duplicate_paths: duplicates.sort(),
            paths: out.paths.slice().sort(),
        };
        Object.assign(membership, out.membership);
    }
    return { trees, membership };
}


// --- the integrity manifest -------------------------------------------------

const JOURNAL_LINK_RE = /journal\.roll20\.net\/(handout|character)\/(-[A-Za-z0-9_-]{5,})/g;
// Roll20 double-escapes a word joiner into link labels; it corrupts ids too.
const WORD_JOINER_RE = /(&amp;#8288;|&#8288;|\u2060)/g;

function _idSet(campaign, collection) {
    const ids = new Set();
    for (const item of _array(campaign[collection])) {
        if (item && item.id !== undefined && item.id !== null) ids.add(String(item.id));
    }
    return ids;
}

function _flattenFolder(folder, list = []) {
    for (const entry of _array(folder)) {
        if (typeof entry === "string") list.push(entry);
        else if (entry && entry.i) _flattenFolder(entry.i, list);
    }
    return list;
}

function buildIntegrity(campaign, options = {}) {
    const now = options.now || (() => new Date().toISOString());
    const findings = [];
    const characters = _idSet(campaign, "characters");
    const handouts = _idSet(campaign, "handouts");
    const pdfs = _idSet(campaign, "pdfs");
    const tracks = _idSet(campaign, "jukebox");

    for (const page of _array(campaign.pages)) {
        for (const graphic of _array(page.graphics)) {
            const represents = _text(graphic && graphic.represents);
            if (represents && !characters.has(represents)) {
                findings.push({
                    kind: "dangling-token-represents",
                    page_id: _text(page.id),
                    page_name: _text(page.name),
                    graphic_id: _text(graphic.id),
                    represents: represents,
                    detail: "token represents a character that no longer exists",
                });
            }
        }
        // A page that exported no content but still has a thumbnail is the
        // signature of a page whose contents failed to load (Dragoncoast).
        const emptyPage = _array(page.graphics).length === 0 &&
            _array(page.paths).length === 0 &&
            _array(page.texts).length === 0;
        if (emptyPage && _text(page.thumbnail)) {
            findings.push({
                kind: "empty-page-with-thumbnail",
                page_id: _text(page.id),
                page_name: _text(page.name),
                thumbnail: _text(page.thumbnail),
                detail: "page exported with no contents but has a thumbnail image",
            });
        }
    }

    for (const [folderName, collection, known] of [
        ["journalfolder", "journal", null],
        ["jukeboxfolder", "jukebox", tracks],
    ]) {
        for (const id of _flattenFolder(campaign[folderName])) {
            const found = known
                ? known.has(id)
                : characters.has(id) || handouts.has(id) || pdfs.has(id);
            if (!found) {
                findings.push({
                    kind: "dangling-folder-entry",
                    folder: folderName,
                    collection: collection,
                    id: id,
                    detail: "folder references an entry that is not in the export",
                });
            }
        }
    }

    findings.push(..._chatFindings(campaign));
    findings.push(..._linkFindings(campaign, characters, handouts));

    findings.sort((a, b) => {
        const left = JSON.stringify([a.kind, a.page_id || "", a.id || "", a.graphic_id || "", a.source_id || ""]);
        const right = JSON.stringify([b.kind, b.page_id || "", b.id || "", b.graphic_id || "", b.source_id || ""]);
        return left < right ? -1 : left > right ? 1 : 0;
    });

    const totals = {};
    for (const finding of findings) {
        totals[finding.kind] = (totals[finding.kind] || 0) + 1;
    }
    return {
        R20Exporter_integrity_format: INTEGRITY_FORMAT,
        generated_at: now(),
        total: findings.length,
        totals: totals,
        findings: findings,
    };
}

function _chatFindings(campaign) {
    const findings = [];
    for (const group of _array(campaign.chat_archive)) {
        if (!group || typeof group !== "object") continue;
        for (const id of Object.keys(group).sort()) {
            const message = group[id];
            if (!message || typeof message !== "object") continue;
            if (message.type !== "rollresult" && message.type !== "gmrollresult") continue;
            let reason = null;
            if (!_text(message.origRoll)) {
                reason = "roll result has no origRoll expression";
            } else {
                try {
                    const parsed = JSON.parse(_text(message.content));
                    if (parsed === null || typeof parsed !== "object") {
                        reason = "roll result payload is not an object";
                    }
                } catch (err) {
                    reason = "roll result payload is not valid JSON";
                }
            }
            if (reason) {
                findings.push({ kind: "unusable-chat-roll", id: id, detail: reason });
            }
        }
    }
    return findings;
}

function _linkFindings(campaign, characters, handouts) {
    const findings = [];
    const scan = (sourceType, item, field) => {
        const text = _text(item[field]).replace(WORD_JOINER_RE, "");
        if (!text) return;
        JOURNAL_LINK_RE.lastIndex = 0;
        let match;
        const seen = new Set();
        while ((match = JOURNAL_LINK_RE.exec(text)) !== null) {
            const [, kind, id] = match;
            if (seen.has(kind + id)) continue;
            seen.add(kind + id);
            const known = kind === "handout" ? handouts.has(id) : characters.has(id);
            if (!known) {
                findings.push({
                    kind: "dangling-journal-link",
                    source_type: sourceType,
                    source_id: _text(item.id),
                    source_field: field,
                    target_type: kind,
                    target_id: id,
                    detail: "text links to a " + kind + " that is not in the export",
                });
            }
        }
    };
    for (const handout of _array(campaign.handouts)) {
        if (!handout) continue;
        scan("handout", handout, "notes");
        scan("handout", handout, "gmnotes");
    }
    for (const character of _array(campaign.characters)) {
        if (!character) continue;
        scan("character", character, "bio");
        scan("character", character, "gmnotes");
    }
    return findings;
}

// --- character sheet identity ----------------------------------------------

const SHEET_CAMPAIGN_KEYS = ["charsheettype", "charactersheet", "character_sheet", "sheettemplate"];

// Recorded, never inferred: how every attribs field must be read depends on it.
// The live page knows best (CharacterSheetsManagerSingleton.sheets is keyed by
// sheet id); campaign fields and character attributes are the offline fallbacks.
function detectCharacterSheet(campaign, scope) {
    const manager = scope && scope.CharacterSheetsManagerSingleton;
    if (manager && manager.sheets && typeof manager.sheets === "object") {
        const templates = Object.keys(manager.sheets).sort();
        if (templates.length) {
            return {
                template: templates[0],
                templates: templates,
                source: "page.CharacterSheetsManagerSingleton.sheets",
            };
        }
    }
    for (const key of SHEET_CAMPAIGN_KEYS) {
        const value = _text(campaign[key]);
        if (value) return { template: value, templates: [value], source: "campaign." + key };
    }
    for (const character of _array(campaign.characters)) {
        for (const attribute of _array(character && character.attributes)) {
            if (attribute && attribute.name === "character_sheet" && _text(attribute.current)) {
                const value = _text(attribute.current);
                return { template: value, templates: [value], source: "character-attribute:character_sheet" };
            }
        }
    }
    return { template: null, templates: [], source: "unavailable" };
}

function detectCharacterSheets(campaign) {
    return _array(campaign && campaign.characters).map((character) => {
        const direct = _text(character && character.charactersheetname);
        const attributeValues = _array(character && (character.attributes || character.attribs))
            .filter((attribute) => attribute && attribute.name === "character_sheet")
            .map((attribute) => _text(attribute.current))
            .filter((value) => value.trim() !== "");
        const distinctAttributes = [...new Set(attributeValues)].sort();
        const templates = [...new Set(
            (direct.trim() !== "" ? [direct] : []).concat(distinctAttributes)
        )].sort();

        let template = null;
        let source = "unavailable";
        let state = "unavailable";
        if (templates.length === 1) {
            template = templates[0];
            state = "available";
            if (direct.trim() !== "" && distinctAttributes.length) {
                source = "character.charactersheetname+character-attribute:character_sheet";
            } else if (direct.trim() !== "") {
                source = "character.charactersheetname";
            } else {
                source = "character-attribute:character_sheet";
            }
        } else if (templates.length > 1) {
            source = "conflicting-character-fields";
            state = "ambiguous";
        }

        return {
            id: _text(character && character.id),
            name: _text(character && character.name),
            template: template,
            templates: templates,
            source: source,
            state: state,
            charactersheetname: direct.trim() !== "" ? direct : null,
            character_sheet_attribute: distinctAttributes.length === 1
                ? distinctAttributes[0] : null,
            character_sheet_attributes: distinctAttributes,
        };
    }).sort((left, right) => {
        if (left.id !== right.id) return left.id < right.id ? -1 : 1;
        return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
}

// --- asset candidates -------------------------------------------------------

const ROLL20_BUCKETS = ["files.d20.io", "files.staging.d20.io"];
const RESOLUTIONS = ["original", "max", "med", "thumb"];

// Roll20 moved its CDN: objects once served from s3.amazonaws.com/files.d20.io
// now answer on files.d20.io directly, and the old spelling 403s (Conv-B048).
// The order is pinned to R20Converter's Entity.hostCandidates -- if the two
// disagree about which host to try first, an asset looks dead in one tool and
// alive in the other.
function hostCandidates(url) {
    let bucket = null;
    let rest = null;
    for (const candidate of ROLL20_BUCKETS) {
        const direct = "https://" + candidate + "/";
        const legacy = "https://s3.amazonaws.com/" + candidate + "/";
        if (url.startsWith(direct)) {
            bucket = candidate;
            rest = url.slice(direct.length);
        } else if (url.startsWith(legacy)) {
            bucket = candidate;
            rest = url.slice(legacy.length);
        }
        if (bucket) break;
    }
    if (!bucket) return [url];
    const spellings = [
        "https://" + bucket + "/" + rest,
        "https://s3.amazonaws.com/" + bucket + "/" + rest,
    ];
    for (const other of ROLL20_BUCKETS) {
        if (other !== bucket) spellings.push("https://" + other + "/" + rest);
    }
    return spellings;
}

function resolutionOf(url) {
    const name = url.split("/").slice(-1)[0].split("?")[0].split(".")[0];
    return RESOLUTIONS.includes(name) ? name : null;
}

// Every resolution is tried on every known host before dropping to a smaller
// one, so a host rename never costs image quality.
function assetCandidates(url) {
    const current = resolutionOf(url);
    const resolutions = current === null ? [null] : RESOLUTIONS;
    const candidates = [];
    const seen = new Set();
    for (const resolution of resolutions) {
        const resolved = resolution === null
            ? url
            : url.replace("/" + current + ".", "/" + resolution + ".");
        for (const spelling of hostCandidates(resolved)) {
            if (seen.has(spelling)) continue;
            seen.add(spelling);
            candidates.push({ url: spelling, variant: resolution });
        }
    }
    return candidates;
}

return {
    R20EXPORTER_VERSION,
    REPORT_FORMAT,
    INTEGRITY_FORMAT,
    INDEX_FORMAT,
    OUTCOME,
    RESOLUTIONS,
    R20ExportReport,
    exportedCollectionCounts,
    liveCollectionCounts,
    compareCollectionCounts,
    countChatMessages,
    checkEngineGlobals,
    sameCollectionCounts,
    characterAttributeSummary,
    buildIndex,
    buildFolderStructure,
    buildSceneBarriers,
    buildIntegrity,
    detectCharacterSheet,
    detectCharacterSheets,
    hostCandidates,
    assetCandidates,
    resolutionOf,
};

});
