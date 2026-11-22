#!/usr/bin/env node
/** curt-claudeai CLI: claude.ai data exports -> .curt files. */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { curtFilename, parseCurt } from "curt-format";
import {
	convertConversation,
	parseExport,
	resolveOutputName,
	serializeResult,
	type ExportConversation,
} from "./claudeai.js";

interface Options {
	outDir?: string;
	stdout: boolean;
}

function usage(): never {
	console.error(`curt-claudeai — claude.ai data exports -> .curt files

Usage:
  curt-claudeai conversations.json
  curt-claudeai <conversation.json> --stdout
  curt-claudeai <directory>
  curt-claudeai '**/*.json' -o ./out

Input: a claude.ai data-export conversations.json (array), a single
conversation export (object), or a directory/glob of such files.

Options:
  -o, --out <dir>   Output directory (default: alongside each input file)
  --stdout          Print a single .curt body to stdout (single-conversation
                    input only)
  -h, --help        Show this help`);
	process.exit(2);
}

function parseArgs(argv: string[]): { inputs: string[]; options: Options } {
	const inputs: string[] = [];
	const options: Options = { stdout: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "-h" || a === "--help") usage();
		if (a === "--stdout") options.stdout = true;
		else if (a === "-o" || a === "--out") {
			const v = argv[++i];
			if (!v) usage();
			options.outDir = v;
		} else if (a.startsWith("-o") && a.length > 2) options.outDir = a.slice(2);
		else if (a.startsWith("-")) {
			console.error(`Unknown option: ${a}`);
			usage();
		} else inputs.push(a);
	}
	return { inputs, options };
}

function expandInputs(inputs: string[]): string[] {
	const files: string[] = [];
	const seen = new Set<string>();
	const add = (f: string) => {
		const abs = resolve(f);
		if (!seen.has(abs)) { seen.add(abs); files.push(abs); }
	};
	for (const input of inputs) {
		if (input.includes("*") || input.includes("?")) {
			const base = input.slice(0, input.search(/[*?]/));
			const root = base.slice(0, base.lastIndexOf("/") + 1) || ".";
			const suffix = input.slice(root.length);
			const walk = (dir: string) => {
				for (const name of readdirSync(dir)) {
					const p = join(dir, name);
					if (statSync(p).isDirectory()) walk(p);
					else if (simpleGlobMatch(p.slice(root.length).replace(/\\/g, "/"), suffix)) add(p);
				}
			};
			if (existsSync(root)) walk(root);
			continue;
		}
		if (!existsSync(input)) {
			console.error(`Not found: ${input}`);
			process.exitCode = 1;
			continue;
		}
		if (statSync(input).isDirectory()) {
			const walk = (dir: string) => {
				for (const name of readdirSync(dir)) {
					const p = join(dir, name);
					if (statSync(p).isDirectory()) walk(p);
					else if (extname(p) === ".json") add(p);
				}
			};
			walk(input);
		} else add(input);
	}
	return files;
}

function simpleGlobMatch(path: string, pattern: string): boolean {
	const rx = new RegExp(
		`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, " ").replace(/\*/g, "[^/]*").replace(/ /g, ".*")}$`,
	);
	return rx.test(path);
}

function main(): void {
	const { inputs: rawInputs, options } = parseArgs(process.argv.slice(2));
	if (rawInputs.length === 0) usage();
	const inputs = expandInputs(rawInputs);
	if (inputs.length === 0 && process.exitCode) process.exit(process.exitCode);
	if (inputs.length === 0) {
		console.error("No .json files matched.");
		process.exit(1);
	}

	let failures = 0;
	const seenNames = new Set<string>();
	for (const file of inputs) {
		let raw: string;
		try {
			raw = readFileSync(file, "utf8");
		} catch (e) {
			console.error(`SKIP (read error): ${file}: ${e instanceof Error ? e.message : e}`);
			failures++;
			continue;
		}
		const parsed = parseExport(raw);
		if ("error" in parsed) {
			console.error(`FAIL: ${file}: ${parsed.error}`);
			failures++;
			continue;
		}
		for (const issue of parsed.issues) console.error(`SKIP (${file}): ${issue}`);
		if (parsed.conversations.length === 0) {
			console.error(`FAIL: ${file}: no convertible conversations`);
			failures++;
			continue;
		}
		if (options.stdout && (inputs.length > 1 || parsed.conversations.length > 1)) {
			console.error("--stdout works with a single input file holding one conversation only.");
			process.exit(2);
		}
		parsed.conversations.forEach((conv: ExportConversation, i: number) => {
			const result = convertConversation(conv, `${basename(file, ".json")}-${i}`);
			const body = serializeResult(result);
			if (process.env.CURT_CLAUDEAI_SELFCHECK !== "0" && !parseCurt(body)) {
				console.error(`FAIL (round-trip validation): ${file} #${i}`);
				failures++;
				return;
			}
			const { conversation, stats } = result;
			if (options.stdout) {
				process.stdout.write(body);
				return;
			}
			const finalDir = options.outDir ? resolve(options.outDir) : undefined;
			if (finalDir) mkdirSync(finalDir, { recursive: true });
			const outName = resolveOutputName(curtFilename(conversation), `${file}#${i}`, seenNames);
			const outPath = finalDir ? join(finalDir, outName) : join(file, "..", outName);
			writeFileSync(outPath, body, "utf8");
			console.log(
				`${basename(outPath)}  <-  ${file} #${i}  (${stats.messages} msgs, ${stats.toolCalls} tool calls, ` +
					`${stats.voiceNotes} voice notes, ${stats.skippedEntries} skipped${parsed.issues.length ? `, ${parsed.issues.length} issues` : ""})`,
			);
		});
	}
	if (failures > 0) {
		console.error(`${failures} file(s) failed.`);
		process.exit(1);
	}
}

main();
