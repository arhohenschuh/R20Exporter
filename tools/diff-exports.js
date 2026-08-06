#!/usr/bin/env node
"use strict";

// Compare two exports of the same campaign, ignoring the fields Roll20 moves on
// its own (tools/volatile-fields.json). Two exports can never be byte-identical
// -- a gate that fails for reasons outside our control gets switched off.
//
//   node tools/diff-exports.js <left-dir> <right-dir>
//
// Both arguments are directories holding an unzipped export.

const fs = require("node:fs");
const path = require("node:path");

const MASK_PATH = path.join(__dirname, "volatile-fields.json");

function loadMask(file = MASK_PATH) {
    return JSON.parse(fs.readFileSync(file, "utf8")).files;
}

function maskValue(value, segments) {
    if (value === null || typeof value !== "object") return;
    const [head, ...rest] = segments;
    if (head.endsWith("[*]")) {
        const key = head.slice(0, -3);
        const array = key === "" ? value : value[key];
        if (!Array.isArray(array)) return;
        for (const item of array) {
            if (rest.length === 0) continue;
            maskValue(item, rest);
        }
        return;
    }
    if (head === "*") {
        for (const key of Object.keys(value)) {
            if (rest.length === 0) delete value[key];
            else maskValue(value[key], rest);
        }
        return;
    }
    if (rest.length === 0) {
        delete value[head];
        return;
    }
    maskValue(value[head], rest);
}

function applyMask(json, paths) {
    for (const spec of paths || []) {
        maskValue(json, spec.split("."));
    }
    return json;
}

function normalise(name, content, mask) {
    if (!name.endsWith(".json")) return content;
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (err) {
        return content;
    }
    return JSON.stringify(applyMask(parsed, mask[path.basename(name)]), null, 2);
}

function diffExports(left, right, mask = loadMask()) {
    const names = new Set([...Object.keys(left), ...Object.keys(right)]);
    const onlyLeft = [];
    const onlyRight = [];
    const changed = [];
    for (const name of [...names].sort()) {
        if (!(name in right)) {
            onlyLeft.push(name);
        } else if (!(name in left)) {
            onlyRight.push(name);
        } else if (normalise(name, left[name], mask) !== normalise(name, right[name], mask)) {
            changed.push(name);
        }
    }
    return { onlyLeft, onlyRight, changed, identical: !onlyLeft.length && !onlyRight.length && !changed.length };
}

function readTree(root) {
    const contents = {};
    const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const name = prefix ? prefix + "/" + entry.name : entry.name;
            if (entry.isDirectory()) walk(full, name);
            else contents[name] = fs.readFileSync(full, name.endsWith(".json") ? "utf8" : "base64");
        }
    };
    walk(root, "");
    return contents;
}

function main(argv) {
    if (argv.length !== 2) {
        console.error("usage: node tools/diff-exports.js <left-dir> <right-dir>");
        return 2;
    }
    const result = diffExports(readTree(argv[0]), readTree(argv[1]));
    for (const name of result.onlyLeft) console.log("only in " + argv[0] + ": " + name);
    for (const name of result.onlyRight) console.log("only in " + argv[1] + ": " + name);
    for (const name of result.changed) console.log("differs: " + name);
    if (result.identical) {
        console.log("identical once volatile fields are masked");
        return 0;
    }
    console.log(result.onlyLeft.length + " missing, " + result.onlyRight.length + " added, " + result.changed.length + " changed");
    return 1;
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { diffExports, applyMask, loadMask, readTree };
