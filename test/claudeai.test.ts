import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convertConversation } from "../src/claudeai.js";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("convertConversation", () => {
	it("maps a minimal single conversation", () => {
		const { conversation, stats } = convertConversation(JSON.parse(fx("single-minimal.json")));
		expect(conversation.id).toBe("conv-0001");
		expect(conversation.title).toBe("Minimal chat");
		expect(conversation.createdAt).toBe(Date.parse("2026-11-01T10:00:00Z"));
		expect(conversation.updatedAt).toBe(Date.parse("2026-11-01T10:05:00Z"));
		expect(conversation.messages).toHaveLength(2);
		expect(conversation.messages[0]).toMatchObject({ id: "m1", role: "user", content: "What is .curt?" });
		expect(conversation.messages[1]).toMatchObject({ id: "m2", role: "assistant" });
		expect(stats.messages).toBe(2);
		expect(stats.skippedEntries).toBe(0);
	});
});

describe("feature blocks", () => {
	const { conversation, stats } = convertConversation(JSON.parse(fx("single-features.json")));

	it("maps voice_note to user text + voiceTitle extra", () => {
		const m = conversation.messages[0];
		expect(m.role).toBe("user");
		expect(m.content).toContain("remind me what an artifact is");
		expect(m.content).toContain("and show one");
		expect(m.voiceNote).toBe(true);
		expect(m.voiceTitle).toBe("Voice memo");
		expect(stats.voiceNotes).toBe(1);
	});

	it("maps thinking to a verbatim message extra", () => {
		const m = conversation.messages[1];
		expect(m.thinking).toBe("user wants an artifact demo");
	});

	it("maps artifacts tool_use into toolCalls with verbatim input", () => {
		const m = conversation.messages[1];
		expect(m.toolCalls).toEqual([
			{ id: "toolu_01", name: "artifacts",
				arguments: { id: "art-1", type: "application/vnd.ant.code", title: "Demo", command: "create", content: "console.log(1)", language: "javascript" } },
		]);
	});

	it("emits a linked tool message and declares tool-linkage", () => {
		const tool = conversation.messages[2];
		expect(tool.role).toBe("tool");
		expect(tool.toolCallId).toBe("toolu_01");
		expect(tool.content).toBe("artifact saved");
		expect(stats.toolCalls).toBe(1);
		expect(stats.toolResults).toBe(1);
		expect(stats.unlinkedToolResults).toBe(0);
		// message f3 is tool-result-only: it produced output, must NOT count
		// as skipped, and must NOT leave a phantom empty message behind
		expect(conversation.messages).toHaveLength(3);
		expect(stats.skippedEntries).toBe(0);
		expect(stats.messages).toBe(3);
		expect(conversation.extensions).toEqual(["tool-linkage"]);
	});

	it("preserves conversation-level extras", () => {
		expect(conversation.summary).toBe("Demo of thinking, artifacts and voice");
		expect(conversation.isStarred).toBe(true);
		expect(conversation.projectUuid).toBe("proj-77");
		expect(conversation.model).toBe("claude-sonnet-5");
		expect(conversation.account).toBe("acct-abc");
	});
});
