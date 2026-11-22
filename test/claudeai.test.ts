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
