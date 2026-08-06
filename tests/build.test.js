"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

function build() {
    execFileSync(process.execPath, [path.join(ROOT, "tools", "build.js")], { cwd: ROOT, stdio: "pipe" });
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version;
    const root = path.join(ROOT, "dist", "R20Exporter-" + version);
    const files = [];
    const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const name = prefix ? prefix + "/" + entry.name : entry.name;
            if (entry.isDirectory()) walk(path.join(dir, entry.name), name);
            else files.push(name);
        }
    };
    walk(root, "");
    return { root, version, files: files.sort() };
}

test("the build ships exactly what the browser loads, and nothing else", () => {
    const { files, version } = build();
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

    for (const file of manifest.content_scripts[0].js) {
        assert.ok(files.includes(file), file + " is loaded by the browser but not in the build");
    }
    for (const icon of Object.values(manifest.icons)) {
        assert.ok(files.includes(icon), icon + " is missing from the build");
    }
    assert.ok(files.includes("manifest.json"));
    assert.equal(manifest.version, version);

    // The old `web-ext build` shipped the whole working tree.
    for (const file of files) {
        assert.doesNotMatch(file, /^(tests|tools|docs|node_modules)\//, file + " must not ship");
        assert.doesNotMatch(file, /^(package\.json|package-lock\.json|ROADMAP\.md|Makefile)$/, file + " must not ship");
    }
});

test("every vendored library ships with its licence", () => {
    const { files } = build();
    const vendored = new Set(files.filter((f) => f.startsWith("libs/")).map((f) => f.split("/").slice(0, 2).join("/")));
    for (const library of vendored) {
        const hasLicence = files.some((f) => f.startsWith(library + "/") && /licen[cs]e/i.test(path.basename(f)));
        assert.ok(hasLicence, library + " ships without a licence file");
    }
});
