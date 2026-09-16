This extension allows you to export a Roll 20 campaign and all of its assets into a ZIP file for backup/archiving purposes.


> **DISCLAIMER**: 
> The use of this tool is meant for backup and archiving purposes of your own campaigns. It is only meant and should only be used on campaigns with content that you own.  
> Even if using it only on your own previously uploaded content, the use of this tool may still be against the [Roll 20 Marketplace Asset End User License Agreement](https://wiki.roll20.net/Marketplace_Asset_EULA)
> and the [Roll 20 EULA or Terms of Service](https://wiki.roll20.net/Terms_of_Service_and_Privacy_Policy).  
> The use of this extension may be considered grounds for account suspension or termination. Use at your own risks.

# R20Exporter

This extension targets **Chrome and Edge**. It uses the File System Access API to write the ZIP straight to a file you choose, which is what makes multi-gigabyte campaigns possible.

**To install,** please visit the [Chrome Webstore](https://chrome.google.com/webstore/detail/r20exporter/apbhfinbjilbkljgcnjjagecnciphnoi)

To export your campaign go to the settings tab in the Roll20 page (the gear icon on the far right of the sidebar), click to expand the "R20Exporter" section, and you should see a button "**Export Campaign to ZIP**". Simply click on it, then wait until the ZIP file is generated and downloaded.

Your browser asks where to save the archive **when the export starts**, not when it finishes: choosing a location up front lets the ZIP be streamed to disk instead of being held in memory. If you cancel that dialog the export still works and the file is downloaded normally at the end.

The ZIP is compressed in background workers, so you can leave the tab in the background or minimize the window and the export will keep running at full speed.

The dialog that opens will show you the various steps the script is undertaking and you can click the Log button to see a more detailed log of what is happening. That dialog window will also prevent you from messing around with the campaign. It is best to let the script do its thing unhindered and to not open another campaign in another window. Once the export process is complete, that window will close on its own and the ZIP file will be downloaded automatically — **unless something was missing**, in which case the dialog stays open and tells you what.

To report any issues, please go to the GitHub [issue tracker](https://github.com/kakaroto/R20Exporter/issues).

# What is in the ZIP

Alongside `campaign.json` and the exported folders, every export carries three
**sidecar** files. They add information *about* the export; nothing in the
Roll20 data itself is ever rewritten, repaired or reordered, so the archive
stays a neutral record of the campaign. Any tool that does not know about the
sidecars can ignore them.

### `export_report.json` — what happened

The one file to read when something looks wrong.

- `totals` — how many assets were referenced, and how they ended:
  `bundled`, `bundled-lower-res`, `canvas-reencoded`, `failed`, `skipped`,
  `pending`. **If `failed` is 0, nothing is missing.** `not-renderable` counts
  separately — see below.
- `assets[]` — one entry per referenced asset: where it landed in the zip
  (`path`), the URL the campaign referenced (`url`), the URL that actually
  answered (`served_from`), which resolution was stored (`variant`), the
  `sha256` and byte count of the stored bytes, and `attempts[]` — every host and
  resolution tried, with its HTTP status. A `failed` entry always carries a
  `reason`.
- `renderable` — whether the stored **name** is one Foundry VTT will draw. The
  zip member deliberately keeps the extension the Roll20 URL advertised, so an
  asset can be present, correct and byte-perfect while being named
  `….svg&cb=5` or `….jfif`, which Foundry silently refuses to render. The file
  is never renamed; the flag exists so a consumer can normalise it. A bundled
  asset with `renderable: false` is not a failed download.
- `folder_orphans_appended` — handouts, PDFs and jukebox tracks that belonged to
  no folder and were appended to the root of `journalfolder` / `jukeboxfolder`.
  This is the one Roll20-sourced field the exporter rewrites — an orphan would
  otherwise never be exported at all — so it is counted rather than hidden.
  Subtract it before comparing root document counts against Roll20.
- `collections` — what the export contains next to what the live campaign held,
  per collection. They should be equal; `collection_mismatches` lists any that
  are not.
- `pin_source` — the live Roll20 page collection used to capture Map Pins.
- `pin_closure` — the number of exported Pins and Handout back-references, plus
  a required `pass: true`. A Jumpgate export is refused when Pins are
  inaccessible or a Handout reference cannot be resolved.
- `character_sheet` — the backward-compatible campaign-level sheet summary and
  where it was read from.
- `character_sheets` — one row per character, including ID, name, all observed
  template values, exact `charactersheetname` / `character_sheet` evidence, its
  source, and an explicit `available`, `ambiguous`, or `unavailable` state. This
  is authoritative for mixed-sheet campaigns.
- `character_attributes` — characters whose sheet never finished loading, and so
  exported without attributes.

### `integrity.json` — what is inconsistent in the campaign itself

Findings are **flagged and never repaired**: dangling `represents` on tokens
whose character was deleted, folder entries and journal links pointing at things
that no longer exist, inconsistent Map Pin links, chat messages with unusable
roll payloads, and pages that exported empty while still having a thumbnail.

### `index.json` — every Roll20 id to `{type, name, folder}`

So a downstream tool can resolve a `journal.roll20.net/handout/<id>` link by
lookup instead of guessing by name.

`folder` is the document's `"/"`-joined folder path, or `null` at the root, and
`folders` describes the tree itself per collection — how many folders, how deep,
how many documents sit in folders versus at the root, any duplicate sibling
paths, and the sorted list of every path.

That block exists because preserving documents is not the same as preserving the
campaign: a consumer can import every one of thousands of journal entries into a
single flat folder and every count will still match. Compare `folders.journal`
after conversion, not the entry count.

`scene_barriers` records, per page, how that page says "door". Roll20 has two
incompatible answers and only the export sees both:

- **`native`** — the page carries real `doors` objects (Jumpgate / UDL).
- **`colour`** — legacy dynamic lighting, which has **no door object at all**. A door
  is a wall-layer path drawn in a different `stroke`, a convention rather than a
  field.
- **`single-colour`** / **`none`** — nothing to infer.

The evidence is deliberately split:

- `stroke_segments` preserves the exact raw Roll20 tokens.
- `stroke_segments_normalized` folds equivalent CSS spellings (`rgb()` / `rgba()` /
  shorthand hex / case) into lowercase six-digit hex; `transparent` remains a sentinel.
- `stroke_scope` declares exactly what was counted: `layer: "walls"` and
  `barrierType: "wall"`. One-way and transparent *barriers* are reported separately and
  never enter the colour tally.
- `native_colour_residue` records normalized non-blue wall colours on a page that also
  carries native door objects. These are evidence for partially migrated pages, **not an
  instruction to turn them into doors**.

A consumer that guesses wrong either loses every door on a legacy page or invents
doors on a modern one, and **one campaign can hold both encodings on different
pages**. `udl_auto_converted` flags a page whose legacy layer Roll20 may already have
deleted during its own migration — for those, an older export can be the only
surviving copy of the door positions. The exporter records facts and never assigns door
semantics to a colour.

`scene_pins` records Map Pin totals per page, including hidden/visible Pins,
Handout links, heading anchors, text labels, and custom images. The complete raw
Pin records live in each `campaign.json` page's `pins[]` array. Custom Pin and
tooltip images are bundled under that page's `pins/` directory.

# Automating an export

`showSaveFilePicker` is a native dialog that a script cannot click. To drive an
export from Playwright or the console without it:

```js
window.R20Exporter_instance.exportCampaignZip(null, { usePicker: false })
```

The archive is then delivered as an ordinary download.

# Optional Compendium Export

Version 1.5.0 adds a separate **Export Compendium** action on supported Roll20
book index pages. Campaign exports are unchanged: enabling the extension does
not automatically request or include any compendium content.

Version 1.5.1 fixes book detection when Roll20 encodes a character in the page
URL but not in its source link, such as the apostrophe in Storm King's Thunder.
Source links and request URLs are preserved; only identity comparisons normalize
the encoding, without combining distinct path segments or source expansions.

Version 1.5.2 also follows source-tagged appendix catalogues and native book
navigation. Exact HTTPS `roll20.net` compendium links are requested through
`app.roll20.net` using the existing session; their original hrefs stay in the
archive. The initial count is **index links**, not the total book size. It grows
to **discovered pages** during export and ends with the captured page count.

Version 1.5.3 continues verified same-book next/previous navigation through empty
entries, so later feature and attribute-only pages are still discovered. Empty
entries remain uncaptured and reported as `empty-compendium-entry`; they can
leave an otherwise useful export **partial**. Wrong-source or malformed pages
never supply navigation, and the existing request limits and cancellation apply.

1. Sign in to Roll20 in Chrome or Edge with access to the book.
2. Open that book's web compendium index, such as the Out of the Abyss index.
3. Click **Export Compendium** in the R20Exporter toolbar and choose a ZIP location.

The toolbar is shown only when the page identifies itself as a book index and
contains direct entry links. The chosen book's expansion ID is required on every
captured page. Login pages, access errors, redirects, and responses for another
expansion are not counted as captured content. Credentials stay in the browser;
the extension neither asks for nor stores passwords or session cookies.

The export includes the index, its directly linked entries, nested catalogue
pages, native attribute rows, and referenced images on Roll20's media hosts.
Nested body links are followed only from nonempty pages without attribute rows and only
when the link explicitly names the selected expansion. Native book navigation
must also explicitly name that expansion. Ordinary attribute-entry cross-references,
other books, and unqualified links from nested pages are not crawled. Unlinked
content, adventure chapters absent from the catalogue, campaign scenes, and
campaign actors are outside this capture's scope.
For example, the Out of the Abyss web index lists reference entries rather than
the adventure chapters. A successful capture does not establish whole-book coverage.

The standalone ZIP contains:

```text
compendium.json
export_report.json
pages/<page-id>-<url-hash>/pagecontent.html
pages/<page-id>-<url-hash>/pageattrs.html
pages/<page-id>-<url-hash>/attributes.json
pages/<page-id>-<url-hash>/illustrations.html
assets/<sha256>.<extension>
```

`compendium.json` uses `R20Compendium_format: "1.0"`. It records the selected
source, request/response URLs, original index links and categories, page IDs,
ordered attribute files, image references, and SHA-256/size for every content
member. HTML fragments are **DOM-serialized**, not byte-identical HTTP responses.
Attribute whitespace, duplicate names, and markup are retained. Original links
are not rewritten; the manifest maps images to bundled files. Full logged-in page
chrome and scripts outside the content fragments are never archived. This is a
source archive, not a sanitized offline website or a Foundry conversion.

The scope is `selected-book-catalogue-and-navigation`. Link records identify
where and how each target was discovered. `requestAliases` records successfully
verified URLs that resolve to the same expansion/page ID and identical captured
content; those aliases do not duplicate pages or assets. The report's `discovery`
block distinguishes page requests, verified aliases, and excluded links.

This ZIP deliberately has no `campaign.json`. Existing R20Converter campaign
imports must not be used on it; downstream compendium conversion is a separate
feature. The extension release itself contains no captured commercial content.

`export_report.json` reports `complete-within-index`, `partial`, `cancelled`, or
`failed`. Every planned page and discovered image gets a terminal outcome.
Inaccessible entries, malformed images, unsupported media such as `srcset`,
inline CSS images or frames, and other media hosts make the result partial.
Partial ZIPs are saved with a visible warning; cancelled or failed runs are not
delivered as ZIPs. **Download report** remains available for diagnostics.

A broken source link remains a failure even when native navigation exposes a
working similarly named page. For example, Shattered Obelisk links to a nonexistent
generic Credits page, while its native navigation names a working book-specific
Credits page. The exporter captures the working page but does not silently repair
the original link or declare it equivalent by name. A partial report must be read
before downstream use; repeatedly exporting cannot fix a source-side 404.

**Cancel** stops queued requests, active reads, retry waits and ZIP generation.
Cancelling the compendium's initial save picker starts no capture. The older
campaign picker's fallback-to-download behavior is unchanged.

Capture uses one request at a time, spaced at least one second apart. Requests
and image decoding have a 30-second deadline; transient network/server failures
and HTTP 429 receive at most two retries. `Retry-After` waits up to two minutes
are honored; longer waits are reported as failures. Limits are 2,000 distinct
page requests (including aliases, enforced throughout nested discovery),
8 MiB per HTML response, 32 MiB per image, and 512 MiB of stored content. Limit
failures are explicit, never silent truncation. Unsupported or changed Roll20
page layouts may require an exporter update.

Use this only for content you are authorized to access and archive. Access to a
book does not grant redistribution rights; the licensing warning above applies.

# Demo

Here's a little demo to show you how it works (note that this may not reflect the latest version of the tool) :

![Demo](images/R20Exporter-demo.gif)

# License

This extension was written by [Youness Alaoui](https://github.com/kakaroto) and is licensed under the LGPL open source license.

See [LICENSE.LGPL.md](LICENSE.LGPL.md) for more information.

The icon for the extension is built using icons made by Delapouite from [GameIcons.net](https://game-icons.net/)

# Further work

This tool was initially released as a patrons only perk on my [Patreon](https://patreon.com/kakaroto) and now that it is no longer in beta, it's been made available to everyone.

These are other tools that I am working on and that might be useful to other D&D players.

* [Beyond20](https://beyond20.here-for-more.info) : A Browser extension to integrate D&D Beyond character sheets into Roll 20 or Foundry VTT
* [R20Converter](https://patreon.com/kakaroto) : A script to convert a Roll20 campaign (exporter with this tool) into a pre-configured world for Foundry VTT (Patreon only)
* [FVTT Modules](https://github.com/kakaroto?utf8=%E2%9C%93&tab=repositories&q=fvtt-module&type=&language=) : Various modules for Foundry VTT that improve Quality of Life or add some familiar features that Roll 20 had for those who don't like changing their habits.

If you'd like to support me in the work I'm doing, you can subscribe to my [Patreon](https://patreon.com/kakaroto) or use my [Paypal](https://www.paypal.me/KaKaRoTo) for a one-time contribution.

Thanks!
