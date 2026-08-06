#!/usr/bin/env node
"use strict";

// Produce a loadable extension folder containing only what ships.
//
//   node tools/build.js            -> dist/R20Exporter-<version>/
//
// Everything the browser needs is derived from manifest.json, so a file added
// to the manifest and forgotten here fails the build instead of the install.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

// Not derived from the manifest, but expected in any distributed copy. The
// vendored libraries must ship with their own licence, not just ours.
const EXTRA_FILES = [
    "LICENSE.LGPL.md",
    "README.md",
    "libs/FileSaver/LICENSE.md",
    "libs/zipjs/LICENSE",
];

function manifestFiles(manifest) {
    const files = new Set(["manifest.json"]);
    for (const icon of Object.values(manifest.icons || {})) files.add(icon);
    for (const script of manifest.content_scripts || []) {
        for (const file of script.js || []) files.add(file);
        for (const file of script.css || []) files.add(file);
    }
    for (const entry of manifest.web_accessible_resources || []) {
        for (const resource of entry.resources || []) {
            if (resource.includes("*")) throw new Error("build.js cannot expand the glob " + resource);
            files.add(resource);
        }
    }
    return files;
}

function copy(relative, destination) {
    const source = path.join(ROOT, relative);
    if (!fs.existsSync(source)) throw new Error("missing file referenced by the manifest: " + relative);
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return fs.statSync(target).size;
}

function main() {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    const destination = path.join(ROOT, "dist", "R20Exporter-" + manifest.version);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });

    let total = 0;
    const copied = [];
    for (const relative of manifestFiles(manifest)) {
        total += copy(relative, destination);
        copied.push(relative);
    }
    for (const relative of EXTRA_FILES) {
        if (fs.existsSync(path.join(ROOT, relative))) {
            total += copy(relative, destination);
            copied.push(relative);
        }
    }

    console.log("R20Exporter " + manifest.version + " -> " + path.relative(ROOT, destination));
    for (const relative of copied.sort()) console.log("  " + relative);
    console.log(copied.length + " files, " + (total / 1024).toFixed(0) + " KB");
    console.log("\nLoad it in Edge: edge://extensions -> Developer mode -> Load unpacked -> " + destination);
}

main();
