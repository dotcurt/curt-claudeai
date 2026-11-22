---
name: curt-convert
description: Convert Claude conversations to .curt single-file format. Use when the user wants to convert, archive, export, or share a Claude conversation: either a claude.ai data export (conversations.json or a single conversation JSON) via npx curt-claudeai, or local Claude Code session transcripts (~/.claude/projects/**/*.jsonl) via npx curt-convert.
license: MIT
---

# Convert conversations to .curt

.curt is an open single-file conversation format (dotcurt.org). Two
converters, chosen by input type:

## 1. claude.ai data export -> npx curt-claudeai

Input: `conversations.json` from a claude.ai Settings > Privacy > Export
Data download (a JSON array), or a single conversation export (a JSON
object). Convert:

```sh
npx curt-claudeai conversations.json -o ./curt-out
npx curt-claudeai one-conversation.json --stdout > convo.curt
```

## 2. Claude Code session transcripts -> npx curt-convert

Input: `.jsonl` files under `~/.claude/projects/<project-dir>/`:

```sh
npx curt-convert ~/.claude/projects/C--tmp-demo/ -o ./curt-out
```

## Choosing when the input is ambiguous

Probe: if the file is a JSON array or an object with a `chat_messages`
array, it is a claude.ai export (use curt-claudeai). If it is JSONL
(one JSON object per line) or lives under `~/.claude/projects/`, it is a
Claude Code transcript (use curt-convert). Say which one you picked and why.

## Safety — read before sharing output

- Output is **transcript-equivalent**: secrets, hostnames, private paths,
  and unreleased code in the conversation ride into the `.curt` file.
  Never share, commit, or publish without scrubbing first.
- A bulk `conversations.json` is the user's ENTIRE account history. For
  sharing, prefer converting a single conversation file, not the bulk
  export.
- Export branches are flattened upstream: duplicate/adjacent messages can
  appear. That is faithful conversion, not a bug.
