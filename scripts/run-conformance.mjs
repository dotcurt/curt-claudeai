/**
 * Conformance vector runner (writer-side) for curt-claudeai.
 *
 * Executes the .curt spec's executable conformance vectors
 * (dot_curt/conformance/vectors/*.json) against the reference
 * implementation and verifies every file in a generated corpus
 * re-parses and round-trips under it.
 *
 * Usage:
 *   node scripts/run-conformance.mjs <corpusDir> [vectorsDir]
 *
 * Env:
 *   CURT_REFERENCE  module path of the reference implementation
 *                   (default: "curt-format" — the published reference)
 *   Vectors default to ../dot_curt/conformance/vectors relative to this repo.
 *
 * Exit 0 = all applicable vectors pass; exit 1 = any failure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const corpusDir = process.argv[2];
const vectorsDir =
	process.argv[3] ??
	process.env.CURT_VECTORS_DIR ??
	resolve(repoRoot, "..", "dot_curt", "conformance", "vectors");

if (!corpusDir) {
	console.error("usage: node scripts/run-conformance.mjs <corpusDir> [vectorsDir]");
	process.exit(2);
}

const refPath = process.env.CURT_REFERENCE ?? "curt-format";
const ref = await import(refPath);
const { parseCurt, serializeCurt, curtFilename } = ref;

let pass = 0;
let fail = 0;
const results = [];
function check(level, name, ok, detail = "") {
	if (ok) pass++;
	else fail++;
	results.push({ level, name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  [${level}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function runVectors(level, file, fn) {
	const spec = JSON.parse(readFileSync(resolve(vectorsDir, file), "utf8"));
	for (const v of spec.vectors) fn(v);
}

// ---- L1 CORE: reference accepts/rejects per vector ----
runVectors("L1", "core.json", (v) => {
	let parsed = null;
	let threw = null;
	try {
		parsed = parseCurt(v.body);
	} catch (e) {
		threw = e;
	}
	const ok =
		v.expect === "accept"
			? parsed !== null
			: parsed === null; // reject: null return or throw
	check("L1", v.name, ok, `expect=${v.expect} got=${parsed !== null ? "accept" : threw ? `throw(${threw.message})` : "reject"}`);
});

// ---- L2 NAMED: curtFilename algorithm ----
runVectors("L2", "named.json", (v) => {
	const got = curtFilename(v.conversation);
	check("L2", v.name, got === v.expect, `expect="${v.expect}" got="${got}"`);
});

// ---- L4 EXTENSIONS: presence/malformation never causes rejection ----
runVectors("L4", "extensions.json", (v) => {
	let parsed = null;
	let threw = null;
	try {
		parsed = parseCurt(v.body);
	} catch (e) {
		threw = e;
	}
	check("L4", v.name, parsed !== null, threw ? `throw(${threw.message})` : "accept");
});

// ---- Writer duty: every emitted corpus file ----
const files = readdirSync(corpusDir).filter((f) => f.endsWith(".curt"));
if (files.length === 0) {
	console.error(`no .curt files in ${corpusDir}`);
	process.exit(2);
}

for (const file of files) {
	const body = readFileSync(resolve(corpusDir, file), "utf8");

	// L1 (writer): parses under the reference
	let parsed = null;
	let threw = null;
	try {
		parsed = parseCurt(body);
	} catch (e) {
		threw = e;
	}
	check("L1", `corpus:${file}:parses`, parsed !== null, threw ? `throw(${threw.message})` : "accept");

	if (parsed === null) continue;

	// Top-level generator/extensions live on the file wrapper, not the
	// conversation parseCurt returns — read them from the raw JSON.
	const rawDoc = JSON.parse(body.replace(/^﻿/, ""));
	const generator = rawDoc.generator;
	const extensions = rawDoc.extensions;

	// L1 (writer): round-trip preserves unknown fields
	const reserialized = serializeCurt(parsed, generator ?? "roundtrip", extensions);
	let reparsed = null;
	try {
		reparsed = parseCurt(reserialized);
	} catch {
		/* reported below */
	}
	check(
		"L1",
		`corpus:${file}:roundtrip`,
		reparsed !== null && JSON.stringify(reparsed) === JSON.stringify(parsed),
		reparsed === null ? "reparse failed" : reparsed && JSON.stringify(reparsed) !== JSON.stringify(parsed) ? "field drift" : "identical",
	);

	// L3 (writer): emitted filename follows curtFilename (bulk convention).
	// The spec rule is SHOULD: exact names pass; collision-discriminated
	// names (curtFilename with a -<hex> inserted before .curt) also pass —
	// readers must never depend on names.
	const derived = curtFilename(parsed);
	const emitted = basename(file);
	const isDiscriminated =
		emitted !== derived &&
		emitted.startsWith(derived.slice(0, -5)) &&
		emitted.endsWith(derived.slice(-5)) &&
		/^-[0-9a-f]+$/.test(emitted.slice(derived.length - 5, emitted.length - 5));
	check(
		"L3",
		`corpus:${file}:naming`,
		emitted === derived || isDiscriminated,
		`emitted="${emitted}" derived="${derived}"${isDiscriminated ? " (collision discriminator, spec SHOULD)" : ""}`,
	);

	// L4 (writer): tool calls present => tool-linkage declared
	const hasToolCalls = (parsed.messages ?? []).some(
		(m) => Array.isArray(m.toolCalls) && m.toolCalls.length > 0,
	);
	const hasToolResults = (parsed.messages ?? []).some((m) => typeof m.toolCallId === "string");
	const exts = extensions;
	const declared = exts === undefined ? false : Array.isArray(exts) && exts.includes("tool-linkage") ? true : exts === "tool-linkage";
	if (hasToolCalls || hasToolResults) {
		check("L4", `corpus:${file}:tool-linkage-declared`, declared, `extensions=${JSON.stringify(exts)}`);
	}
}

console.log(`\n${pass} passed, ${fail} failed (vectors dir: ${vectorsDir}; reference: ${refPath})`);
process.exit(fail === 0 ? 0 : 1);
