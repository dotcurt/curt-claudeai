/**
 * Convert claude.ai data exports to .curt conversations.
 *
 * Export schema ground truth (real-export validated, docs/schemas.md of
 * osteele/claude-chat-viewer + r/ClaudeAI thread, 2026-11):
 * - conversations.json = array of conversation objects; individual exports
 *   are a single object (no `account`).
 * - Content block types in real exports: text, thinking, tool_use
 *   (artifacts are tool_use with name "artifacts"), tool_result, voice_note.
 *   NO image blocks; attachments/files arrays are always empty in current
 *   exports — no binary rides the export.
 * - Legacy exports: `content` is a plain string.
 * - Export flattens conversation trees; duplicate/adjacent messages are
 *   possible. Converted faithful-as-is (documented, no dedupe).
 */

import { type CurtConversation, type CurtMessage, serializeCurt } from "curt-format";

export const GENERATOR = "curt-claudeai@1.0.0";
/** Extension declared when tool calls are emitted (see EXTENSIONS.md). */
export const TOOL_LINKAGE = "tool-linkage";

export interface ConvertStats {
	messages: number;
	toolCalls: number;
	toolResults: number;
	/** tool_result blocks with no matching tool_use id in any prior call. */
	unlinkedToolResults: number;
	voiceNotes: number;
	/** chat_messages entries that produced no output (empty after mapping). */
	skippedEntries: number;
}

export interface ConvertResult {
	conversation: CurtConversation;
	stats: ConvertStats;
}

interface Block {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	summaries?: unknown;
	cut_off?: unknown;
	id?: unknown;
	name?: unknown;
	input?: unknown;
	content?: unknown;
	is_error?: unknown;
	title?: unknown;
	[key: string]: unknown;
}

interface ExportMessage {
	uuid?: unknown;
	text?: unknown;
	content?: unknown;
	sender?: unknown;
	created_at?: unknown;
	[key: string]: unknown;
}

export interface ExportConversation {
	uuid?: unknown;
	name?: unknown;
	created_at?: unknown;
	updated_at?: unknown;
	chat_messages?: unknown;
	[key: string]: unknown;
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

/** ISO timestamp -> epoch ms; 0 when missing/unparseable. */
export function parseTimestamp(v: unknown): number {
	if (typeof v !== "string") return 0;
	const ms = Date.parse(v);
	return Number.isFinite(ms) ? ms : 0;
}

function titleFrom(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

/** Plain text out of a tool_result `content` (string or block array). */
function toolResultText(content: unknown): { text: string; nonText: Block[] } {
	if (typeof content === "string") return { text: content, nonText: [] };
	if (Array.isArray(content)) {
		const nonText: Block[] = [];
		const parts: string[] = [];
		for (const b of content) {
			if (typeof b === "string") parts.push(b);
			else if (isObj(b) && b.type === "text" && typeof b.text === "string") parts.push(b.text);
			else if (isObj(b)) nonText.push(b as Block);
		}
		return { text: parts.join("\n"), nonText };
	}
	return { text: "", nonText: [] };
}

export function convertConversation(conv: ExportConversation, fallbackId = "conversation"): ConvertResult {
	const stats: ConvertStats = {
		messages: 0, toolCalls: 0, toolResults: 0,
		unlinkedToolResults: 0, voiceNotes: 0, skippedEntries: 0,
	};
	const messages: CurtMessage[] = [];
	const toolCallIds = new Set<string>();
	let firstUserText: string | undefined;

	const rawMessages = Array.isArray(conv.chat_messages) ? (conv.chat_messages as ExportMessage[]) : [];
	for (const entry of rawMessages) {
		if (!isObj(entry)) { stats.skippedEntries++; continue; }
		const sender = asString(entry.sender);
		if (sender !== "human" && sender !== "assistant") { stats.skippedEntries++; continue; }
		const timestamp = parseTimestamp(entry.created_at);
		const id = asString(entry.uuid) ?? `msg-${messages.length}`;
		const textParts: string[] = [];
		const thinkingParts: string[] = [];
		const toolCalls: { id: string; name: string; arguments: unknown }[] = [];
		const voiceTitles: string[] = [];
		let voiceNoteSeen = false;
		let produced = false;

		const content = entry.content;
		if (typeof content === "string") {
			const s = content.trim();
			if (s) textParts.push(s);
		} else if (Array.isArray(content)) {
			for (const b of content as Block[]) {
				if (!isObj(b)) continue;
				if (b.type === "text" && typeof b.text === "string") {
					textParts.push(b.text);
				} else if (b.type === "thinking" && typeof b.thinking === "string") {
					thinkingParts.push(b.thinking);
				} else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
					toolCalls.push({ id: b.id, name: b.name, arguments: b.input ?? null });
					toolCallIds.add(b.id);
					stats.toolCalls++;
				} else if (b.type === "tool_result") {
					const callId = asString(b.tool_use_id);
					const { text, nonText } = toolResultText(b.content);
					const toolMsg: CurtMessage = {
						id: `${id}-tool`,
						role: "tool",
						content: text,
						timestamp,
						toolCallId: callId ?? "",
					};
					if (b.is_error === true) toolMsg.isError = true;
					if (nonText.length > 0) toolMsg.nonTextContent = nonText;
					messages.push(toolMsg);
					produced = true;
					stats.toolResults++;
					if (!callId || !toolCallIds.has(callId)) stats.unlinkedToolResults++;
				} else if (b.type === "voice_note") {
					voiceNoteSeen = true;
					if (typeof b.text === "string") textParts.push(b.text);
					if (typeof b.title === "string") voiceTitles.push(b.title);
				}
			}
		} else if (typeof entry.text === "string" && entry.text.trim()) {
			// legacy/odd exports: text without a usable content array
			textParts.push(entry.text);
		}

		const body = textParts.join("\n\n").trim();
		if (!body && thinkingParts.length === 0 && toolCalls.length === 0) {
			if (!produced) stats.skippedEntries++;
			continue;
		}
		const msg: CurtMessage = {
			id,
			role: sender === "human" ? "user" : "assistant",
			content: body,
			timestamp,
		};
		if (thinkingParts.length > 0) msg.thinking = thinkingParts.join("\n\n");
		if (toolCalls.length > 0) msg.toolCalls = toolCalls;
		if (voiceNoteSeen) {
			msg.voiceNote = true;
			stats.voiceNotes++;
			if (voiceTitles.length > 0) msg.voiceTitle = voiceTitles[0];
		}
		messages.push(msg);
		if (sender === "human" && body) firstUserText ??= body;
	}

	const fallbackTitle = firstUserText ? titleFrom(firstUserText) : "";
	const conversation: CurtConversation = {
		id: asString(conv.uuid) ?? fallbackId,
		title: asString(conv.name) || fallbackTitle,
		createdAt: parseTimestamp(conv.created_at),
		updatedAt: parseTimestamp(conv.updated_at),
		messages,
		provider: "anthropic",
	};
	if (typeof conv.summary === "string" && conv.summary) conversation.summary = conv.summary;
	if (conv.is_starred === true) conversation.isStarred = true;
	if (typeof conv.project_uuid === "string") conversation.projectUuid = conv.project_uuid;
	if (typeof conv.model === "string" && conv.model) conversation.model = conv.model;
	if (typeof conv.account === "string" && conv.account) conversation.account = conv.account;
	if (stats.toolCalls > 0) conversation.extensions = [TOOL_LINKAGE];

	stats.messages = messages.length;
	return { conversation, stats };
}

/** Serialize a converted conversation as a complete .curt file body. */
export function serializeResult(result: ConvertResult): string {
	return serializeCurt(
		result.conversation,
		GENERATOR,
		result.conversation.extensions as string[] | undefined,
	);
}
