"use strict";

// A small campaign with defects planted on purpose: a token whose character was
// deleted, a page that exported empty but has a thumbnail, an asset that is dead
// on every host and variant, a journal link to a handout that no longer exists,
// and a roll result with an unusable payload.

const IMG = "https://files.d20.io/images";

function model(attrs, extra = {}) {
    return Object.assign(
        {
            id: attrs.id,
            name: attrs.name,
            toJSON: () => JSON.parse(JSON.stringify(attrs)),
        },
        extra
    );
}

function collection(models) {
    return {
        models: models,
        length: models.length,
        toJSON: () => models.map((m) => m.toJSON()),
    };
}

function blobModel(attrs, blobs) {
    return model(attrs, {
        _getLatestBlob: (field, cb) => cb(global.escape(blobs[field] === undefined ? "" : blobs[field])),
    });
}

function attribute(id, name, current, max = "") {
    return { id: id, name: name, current: current, max: max };
}

const CHAT_ARCHIVE = [
    {
        "msg-good": {
            type: "rollresult",
            content: JSON.stringify({ type: "V", rolls: [], resultType: "sum", total: 7 }),
            origRoll: "1d20+2",
            who: "Erky Timbers",
            playerid: "player-gm",
            ".priority": 1700000000000,
        },
        "msg-broken": {
            type: "rollresult",
            content: "",
            origRoll: "",
            who: "Erky Timbers",
            playerid: "player-gm",
            ".priority": 1700000001000,
        },
        "msg-chat": {
            type: "general",
            content: "Hello",
            who: "Erky Timbers",
            playerid: "player-gm",
            ".priority": 1700000002000,
        },
    },
];

function chatArchiveHtml() {
    const encoded = Buffer.from(JSON.stringify(CHAT_ARCHIVE), "binary").toString("base64");
    return '<html><body><script type="text/javascript">var msgdata = "' + encoded + '";\n</script></body></html>';
}

const DEAD_ASSET = IMG + "/dead/med.png?9999";
// Only reachable under the pre-rename spelling: the Conv-B048 case.
const LEGACY_ONLY_ASSET = IMG + "/legacy/med.png?7777";
const LEGACY_HOST = "https://s3.amazonaws.com/files.d20.io/images";

function buildCampaign() {
    const characters = [
        blobModel(
            {
                id: "char-alive",
                name: "Erky Timbers",
                avatar: IMG + "/erky/med.png?1",
                inplayerjournals: "all",
                controlledby: "",
                bio: "escaped",
                gmnotes: "",
                defaulttoken: "escaped",
                attributes: [],
                abilities: [],
            },
            {
                bio: '<p>See <a href="https://journal.roll20.net/handout/-HANDOUTGONE1">the note</a> and '
                    + '<a href="https://journal.roll20.net/character/-CHARACTERALIVE">Erky</a>.</p>',
                gmnotes: "",
                defaulttoken: JSON.stringify({ imgsrc: IMG + "/erky-token/med.png?2", sides: "" }),
            }
        ),
        blobModel(
            {
                id: "-CHARACTERALIVE",
                name: "Sir Braford",
                avatar: "",
                inplayerjournals: "",
                controlledby: "",
                bio: "",
                gmnotes: "",
                defaulttoken: "",
                attributes: [],
                abilities: [],
            },
            {}
        ),
    ];
    characters[0].attribs = collection([model(attribute("attr-1", "character_sheet", "OGL_2.0"))]);
    characters[0].abilities = collection([]);
    characters[1].attribs = collection([model(attribute("attr-2", "hp", "11", "11"))]);
    characters[1].abilities = collection([]);

    const handouts = [
        blobModel(
            {
                id: "handout-1",
                name: "Rumours",
                avatar: IMG + "/rumours/med.png?3",
                inplayerjournals: "all",
                controlledby: "",
                pins: JSON.stringify([{
                    id: "pin-1",
                    page: "page-1",
                    subLink: "1. Entrance",
                    subLinkType: "headerGM",
                }]),
                notes: "escaped",
                gmnotes: "escaped",
            },
            {
                notes: '<p>Ask <a href="https://journal.roll20.net/character/char-alive">Erky</a>.</p>',
                gmnotes: "<p>Nothing yet.</p>",
            }
        ),
    ];

    const goodPage = model(
        {
            id: "page-1",
            name: "Sunless Citadel",
            zorder: "graphic-1,graphic-2,graphic-3,graphic-4",
            thumbnail: IMG + "/page1thumb/med.png?4",
        },
        {
            fullyLoaded: true,
            thegraphics: collection([
                model({ id: "graphic-1", name: "Map", imgsrc: IMG + "/map/med.png?5", represents: "", sides: "" }),
                model({ id: "graphic-2", name: "Erky", imgsrc: IMG + "/erky-token/med.png?2", represents: "char-alive", sides: "" }),
                model({ id: "graphic-3", name: "Ghost", imgsrc: DEAD_ASSET, represents: "char-deleted", sides: "" }),
                model({ id: "graphic-4", name: "Old Map", imgsrc: LEGACY_ONLY_ASSET, represents: "", sides: "" }),
            ]),
            thetexts: collection([]),
            thepaths: collection([]),
            thepins: collection([
                model({
                    id: "pin-1",
                    x: 350,
                    y: 420,
                    bgColor: "#242424",
                    shape: "teardrop",
                    icon: "base-dot",
                    pinImage: "/images/pin-marker.png",
                    customizationType: "icon",
                    useTextIcon: true,
                    iconText: "1",
                    link: "handout-1",
                    linkType: "handout",
                    subLink: "1. Entrance",
                    subLinkType: "headerGM",
                    title: "1. Entrance",
                    notes: "",
                    gmNotes: "The old stairs descend into darkness.",
                    tooltipImage: IMG + "/pin-tooltip/med.png?9",
                    visibleTo: "",
                    tooltipVisibleTo: "",
                    scale: 1,
                }),
            ]),
            doors: collection([]),
            windows: collection([]),
        }
    );

    const emptyPage = model(
        {
            id: "page-2",
            name: "Archived Level 2",
            zorder: "",
            thumbnail: IMG + "/page2thumb/med.png?6",
        },
        {
            fullyLoaded: true,
            thegraphics: collection([]),
            thetexts: collection([]),
            thepaths: collection([]),
            thepins: collection([]),
            doors: collection([]),
            windows: collection([]),
        }
    );

    const players = [
        model({ id: "player-gm", displayname: "GM", d20userid: "account-1", macrobar: "", journalfolderstatus: "", jukeboxfolderstatus: "" }, {
            macros: collection([model({ id: "macro-1", name: "Perception", action: "/roll 1d20" })]),
        }),
    ];

    const decks = [
        model({ id: "deck-1", name: "Fate", avatar: "", currentDeck: "", discardPile: "" }, {
            cards: collection([model({ id: "card-1", name: "Ace", avatar: "" })]),
        }),
    ];

    const tables = [
        model({ id: "table-1", name: "Wandering Monsters" }, {
            tableitems: collection([model({ id: "item-1", name: "Kobold", avatar: "" })]),
        }),
    ];

    const jukebox = [{ id: "track-1", title: "Dungeon", source: "My Audio", track_id: "https://example.com/dungeon.mp3" }];

    const Campaign = {
        characters: collection(characters),
        handouts: collection(handouts),
        pdfs: collection([]),
        pages: collection([goodPage, emptyPage]),
        players: collection(players),
        decks: collection(decks),
        rollabletables: collection(tables),
        toJSON: () => ({
            release: "jumpgate",
            charsheettype: "OGL_2.0",
            journalfolder: JSON.stringify([{ n: "Notes", i: ["handout-1"] }, "char-alive", "-CHARACTERALIVE"]),
            jukeboxfolder: JSON.stringify(["track-1"]),
            turnorder: "",
            playerpageid: "page-1",
            lastmodified: 1700000000,
        }),
    };

    const Jukebox = { playlist: { models: jukebox.map((t) => model(t)), toJSON: () => JSON.parse(JSON.stringify(jukebox)) } };

    return { Campaign, Jukebox };
}

function buildRoutes({ deadAssets = [DEAD_ASSET], legacyOnlyAssets = [LEGACY_ONLY_ASSET], corsBlockedHost = "https://s3.amazonaws.com/" } = {}) {
    const variants = (url) => ["original", "max", "med", "thumb"].map((v) => url.replace(/\/(original|max|med|thumb)\./, "/" + v + "."));
    const dead = new Set();
    for (const url of deadAssets) for (const spelling of variants(url)) dead.add(spelling);
    const legacyOnly = new Set();
    for (const url of legacyOnlyAssets) for (const spelling of variants(url)) legacyOnly.add(spelling);

    return (url) => {
        if (url.includes("/campaigns/chatarchive/")) {
            return { body: chatArchiveHtml(), type: "text/html" };
        }
        const direct = url.replace("https://s3.amazonaws.com/files.d20.io/", "https://files.d20.io/");
        if (legacyOnly.has(direct)) {
            // Answers only under the legacy spelling, exactly as Roll20's CDN did
            // before the rename made the new host the working one.
            return url.startsWith(LEGACY_HOST) ? { body: "image-bytes-for:" + direct, type: "image/png" } : { status: 403 };
        }
        if (corsBlockedHost && url.startsWith(corsBlockedHost)) {
            // A CORS rejection never carries an HTTP status (B007).
            return new TypeError("Failed to fetch");
        }
        if (dead.has(direct)) return { status: 404 };
        if (url.startsWith(IMG)) return { body: "image-bytes-for:" + url, type: "image/png" };
        if (url.startsWith("/images/")) return { body: "image-bytes-for:" + url, type: "image/png" };
        if (url.endsWith(".mp3")) return { body: "audio-bytes", type: "audio/mpeg" };
        return undefined;
    };
}

module.exports = {
    buildCampaign,
    buildRoutes,
    chatArchiveHtml,
    CHAT_ARCHIVE,
    DEAD_ASSET,
    LEGACY_ONLY_ASSET,
    LEGACY_HOST,
    IMG,
    model,
    collection,
};
