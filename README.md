# curt-claudeai

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/curt-claudeai.svg)](https://www.npmjs.com/package/curt-claudeai)

Convert [claude.ai](https://claude.ai) data exports into [`.curt`](https://dotcurt.org) single-file conversation files.

> **Warning: output is transcript-equivalent.** Conversion is faithful, not
> redacting: secrets, tokens, hostnames, private paths, and unreleased code in
> a conversation ride into the `.curt` file. Never share, commit, or publish
> `.curt` output without scrubbing first.

## Why

Claude's own data export is a proprietary, one-off JSON layout that only makes sense to code written against it. `.curt` is an open, single-file conversation format: one self-describing JSON file per conversation, portable across tools and years. Converters like this one are the wedge that turns locked-in export dumps into an archive you actually own — the growing set of ecosystem writers is tracked in [dot_curt/CAPABILITIES.md](https://github.com/dotcurt/dot_curt/blob/main/CAPABILITIES.md).

## Install

```sh
npm install -g curt-claudeai
```

Or run it without installing:

```sh
npx curt-claudeai
```

Requires Node.js >= 20.

## Usage

```
curt-claudeai conversations.json              # bulk export file
curt-claudeai one-conversation.json --stdout  # single conversation to stdout
curt-claudeai ./exports/                      # every .json in a directory
curt-claudeai '**/conversations*.json' -o ./out   # quoted glob
```

**Bulk export file.** Point it at the `conversations.json` from a claude.ai
Settings → Privacy → Export Data download:

```sh
curt-claudeai conversations.json -o ./curt-out
```

Every conversation in the array is written as its own `.curt` file.

**Single conversation + `--stdout`.** A single conversation export (a JSON
object) can be streamed instead of written to disk:

```sh
curt-claudeai one-conversation.json --stdout > my-chat.curt
```

`--stdout` only works when the input resolves to exactly one conversation.

**Directory or glob.** Give it a directory to convert every `.json` file in
it (recursively), or a quoted glob. Quote the glob so your shell doesn't
expand it first:

```sh
curt-claudeai ./exports/
curt-claudeai '**/conversations*.json' -o ./out
```

**Output location and naming.** By default each `.curt` file is written
alongside its input file; `-o <dir>` redirects everything to one directory
(created if needed). File names follow the `.curt` naming convention —
creation date, slugified title, id suffix — e.g.
`2026-11-01 minimal-chat onv-0001.curt`. If two conversations in the same
run would produce the same name, later ones get a deterministic
`-<6 hex>` suffix derived from a SHA-256 of the source key
(e.g. `2026-11-03 bulk-a bulk-a-cd0405.curt`), so a run never silently
overwrites itself.

**Self-check.** Every written file is re-parsed and round-tripped before the
CLI reports success. This costs a second parse and is almost never what you
want to skip; if you do (e.g. in a tight pipeline over huge exports):

```sh
CURT_CLAUDEAI_SELFCHECK=0 curt-claudeai conversations.json
```

**Exit codes.** `0` — all conversions succeeded. `1` — at least one input
failed (unreadable, not valid export JSON, no convertible conversations, no
files matched). `2` — usage error (no arguments, unknown option, or
`--stdout` on a multi-conversation input).

## What gets converted

| Export | `.curt` |
|---|---|
| `uuid`, `name`, `created_at`, `updated_at` | conversation `id`, `title`, `createdAt`, `updatedAt` |
| sender `human` / `assistant` | message `role` `user` / `assistant` |
| `text` block | message body text |
| `thinking` block | `thinking` field (joined across blocks) |
| `tool_use` block (artifacts are `tool_use` with name `artifacts`) | tool call |
| `tool_result` block | tool result, linked by `tool_use_id` |
| `voice_note` block | body text + `voiceNote: true`, `voiceTitle` from the note title |
| `summary`, `is_starred`, `project_uuid`, `model`, `account` | `summary`, `isStarred`, `projectUuid`, `model`, `account` extras |
| branches | flattened in export order — kept faithful, no dedupe |

On capabilities: claude.ai exports contain no image blocks today (uploaded
images do not come through the export), so `images-inline` is deliberately
**not** declared. `tool-linkage` is declared on conversations that contain
tool calls. BOM-prefixed files are tolerated, and all three content shapes
seen in the wild — current block arrays, bulk exports, and the older
plain-string `content` — are accepted.

## The /curt-convert skill

This repo ships a Claude Code skill, `/curt-convert`, that teaches Claude
when and how to use this converter (and its Claude Code JSONL sibling) —
including a safety briefing about sharing transcript-equivalent output.

Install one of two ways:

**Manual.** Clone the repo, then copy (or symlink) the skill directory into
your skills folder:

```sh
cp -r skills/curt-convert/ ~/.claude/skills/curt-convert/
```

**Plugin marketplace.** Add the dotcurt marketplace and install:

```sh
claude plugin marketplace add dotcurt/curt-claudeai
claude plugin install curt-claudeai@dotcurt
```

The skill is plain markdown with portable frontmatter, so it also works
uploaded to claude.ai Skills unchanged.

## Caveats

- Output is **transcript-equivalent**: anything in the conversation —
  secrets, tokens, hostnames, private paths, unreleased code — rides into
  the `.curt` file. See the warning at the top; scrub before sharing.
- A bulk `conversations.json` is your **entire account history**. When
  sharing one conversation, prefer exporting/converting that single file
  rather than the bulk export.
- claude.ai flattens export branches upstream, so duplicate or adjacent
  messages can appear. That is faithful conversion, not a bug.
- `thinking` and `voiceTitle` are carried as extra fields; `.curt` readers
  that don't know them ignore them gracefully.

## Conformance

This writer passes the `.curt` spec's executable conformance vectors —
all of them, covering levels L1 core (parse/round-trip), L2 named, L3
writer-side (naming), and L4 extensions including tool-linkage — against
a corpus generated from real export shapes. From a repo clone, reproduce
it against your own corpus with:

```sh
node scripts/run-conformance.mjs <corpusDir>
```

The spec and the vectors themselves live in
[dotcurt/dot_curt](https://github.com/dotcurt/dot_curt).

## Family

- [curt-convert](https://github.com/dotcurt/curt-convert) — Claude Code session JSONL transcripts
- [curt-hermes](https://github.com/dotcurt/curt-hermes) — Hermes agent logs
- [curt-wildchat](https://github.com/dotcurt/curt-wildchat) — WildChat datasets

Format home and spec: [dotcurt.org](https://dotcurt.org) ·
[dotcurt/dot_curt](https://github.com/dotcurt/dot_curt)

## Development

```sh
npm run build                        # tsc → dist/
npx vitest run                       # unit tests
claude plugin validate . --strict    # plugin + marketplace manifests
```

Releases: bump `package.json` and `.claude-plugin/plugin.json`
independently — a SKILL.md-only change bumps only `plugin.json`.

## License

[MIT](LICENSE).
