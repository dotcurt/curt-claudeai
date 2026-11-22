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
 *   CURT_REFERENCE   module path of the reference implementation
 *                    (default: "curt-format" — the published reference)
 *   CURT_VECTORS_DIR directory holding core/named/bulk/extensions.json
 *                    (default: ../dot_curt/conformance/vectors relative
 *                    to this repo; CLI arg 3 overrides both)
 *
 * Exit codes:
 *   0 = all applicable vectors pass
 *   1 = at least one vector/corpus check failed
 *   2 = infra/setup error (missing corpus dir, unreadable or malformed
 *       vector JSON, unresolvable CURT_REFERENCE, unknown v.expect value)
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

/** Infra/setup failure: nothing about the vectors themselves was judged. */
function infra(msg) {
	console.error(`conformance: ${msg}`);
	process.exit(2);
}

if (!corpusDir) {
	console.error("usage: node scripts/run-conformance.mjs <corpusDir> [vectorsDir]");
	process.exit(2);
}

const refPath = process.env.CURT_REFERENCE ?? "curt-format";
let ref;
try {
	ref = await import(refPath);
} catch (e) {
	infra(`cannot load reference implementation "${refPath}": ${e.message}`);
}
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
	let spec;
	try {
		spec = JSON.parse(readFileSync(resolve(vectorsDir, file), "utf8"));
	} catch (e) {
		infra(`cannot read/parse vector file ${resolve(vectorsDir, file)}: ${e.message}`);
	}
	for (const v of spec.vectors) fn(v);
}

/** parseCurt with throw folded into a null + reason. */
function tryParse(body) {
	try {
		return { parsed: parseCurt(body), threw: null };
	} catch (e) {
		return { parsed: null, threw: e };
	}
}
function verdict({ parsed, threw }) {
	return parsed !== null ? "accept" : threw ? `throw(${threw.message})` : "reject";
}

// ---- L1 CORE: reference accepts/rejects per vector ----
runVectors("L1", "core.json", (v) => {
	if (v.expect !== "accept" && v.expect !== "reject") {
		infra(`core.json vector "${v.name}" has unknown expect=${JSON.stringify(v.expect)} (want "accept" or "reject")`);
	}
	const outcome = tryParse(v.body);
	const ok = v.expect === "accept" ? outcome.parsed !== null : outcome.parsed === null;
	check("L1", v.name, ok, `expect=${v.expect} got=${verdict(outcome)}`);
});

// ---- L2 NAMED: curtFilename algorithm ----
runVectors("L2", "named.json", (v) => {
	const got = curtFilename(v.conversation);
	check("L2", v.name, got === v.expect, `expect="${v.expect}" got="${got}"`);
});

// ---- L4 EXTENSIONS: presence/malformation never causes rejection ----
runVectors("L4", "extensions.json", (v) => {
	const outcome = tryParse(v.body);
	check("L4", v.name, outcome.parsed !== null, verdict(outcome));
});

// ---- Writer duty: every emitted corpus file ----
let files;
try {
	files = readdirSync(corpusDir).filter((f) => f.endsWith(".curt"));
} catch (e) {
	infra(`cannot read corpus dir ${corpusDir}: ${e.message}`);
}
if (files.length === 0) {
	infra(`no .curt files in ${corpusDir}`);
}

for (const file of files) {
	let body;
	try {
		body = readFileSync(resolve(corpusDir, file), "utf8");
	} catch (e) {
		infra(`cannot read corpus file ${resolve(corpusDir, file)}: ${e.message}`);
	}

	// L1 (writer): parses under the reference
	const outcome = tryParse(body);
	check("L1", `corpus:${file}:parses`, outcome.parsed !== null, verdict(outcome));

	if (outcome.parsed === null) continue;
	const parsed = outcome.parsed;

	// Top-level generator/extensions live on the file wrapper, not the
	// conversation parseCurt returns — read them from the raw JSON.
	let rawDoc;
	try {
		rawDoc = JSON.parse(body.replace(/^﻿/, ""));
	} catch (e) {
		infra(`corpus file ${resolve(corpusDir, file)} parses as .curt but not as JSON: ${e.message}`);
	}
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
	const declared =
		extensions === "tool-linkage" ||
		(Array.isArray(extensions) && extensions.includes("tool-linkage"));
	if (hasToolCalls || hasToolResults) {
		check("L4", `corpus:${file}:tool-linkage-declared`, declared, `extensions=${JSON.stringify(extensions)}`);
	}
}

console.log(`\n${pass} passed, ${fail} failed (vectors dir: ${vectorsDir}; reference: ${refPath})`);
process.exit(fail === 0 ? 0 : 1);
