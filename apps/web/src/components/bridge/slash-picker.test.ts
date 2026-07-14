import { expect, it } from "vitest";
import {
	applySlashPickerSelection,
	buildSlashPickerItems,
	clampActiveIndex,
	parseSlashQuery,
} from "./slash-picker";

it("recognizes a bare slash or a slash-prefixed query with no space yet", () => {
	expect(parseSlashQuery("/")).toEqual({ prefix: "", query: "" });
	expect(parseSlashQuery("/co")).toEqual({ prefix: "", query: "co" });
});

it("recognizes a slash token typed anywhere, preserving the preceding text", () => {
	expect(parseSlashQuery("fix this /co")).toEqual({
		prefix: "fix this ",
		query: "co",
	});
	expect(parseSlashQuery("a /b")).toEqual({ prefix: "a ", query: "b" });
});

it("stops recognizing a query once a space follows the slash", () => {
	expect(parseSlashQuery("/co ")).toBeNull();
	expect(parseSlashQuery("/co bar")).toBeNull();
	expect(parseSlashQuery("fix /co bar")).toBeNull();
});

it("does not treat a slash mid-word or plain text as a query", () => {
	expect(parseSlashQuery("a/b")).toBeNull();
	expect(parseSlashQuery("hello")).toBeNull();
	expect(parseSlashQuery("")).toBeNull();
});

it("filters commands then skills by case-insensitive prefix, dropping non-matches", () => {
	const items = buildSlashPickerItems(
		{ commands: ["compact", "clear"], skills: ["pdf", "compare-docs"] },
		"co"
	);
	expect(items).toEqual([
		{ kind: "command", name: "compact" },
		{ kind: "skill", name: "compare-docs" },
	]);
});

it("matches an empty query against everything (a bare '/')", () => {
	const items = buildSlashPickerItems(
		{ commands: ["compact"], skills: ["pdf"] },
		""
	);
	expect(items).toEqual([
		{ kind: "command", name: "compact" },
		{ kind: "skill", name: "pdf" },
	]);
});

it("tolerates a leading slash already present on a reported name", () => {
	const items = buildSlashPickerItems({ commands: ["/compact"] }, "co");
	expect(items).toEqual([{ kind: "command", name: "compact" }]);
});

it("contributes nothing for a capability list the session hasn't reported", () => {
	expect(buildSlashPickerItems({}, "")).toEqual([]);
	expect(buildSlashPickerItems({ commands: ["compact"] }, "")).toEqual([
		{ kind: "command", name: "compact" },
	]);
});

// P2-T5: usage-frequency sort — counted items first (count desc), zero-count
// items keep the agent-reported order after them, all WITHIN each group.
it("sorts counted items first within a group, ties and zero-counts keeping reported order", () => {
	const items = buildSlashPickerItems(
		{ commands: ["alpha", "bravo", "charlie", "delta"] },
		"",
		{ charlie: 3, delta: 3, bravo: 1 }
	);
	expect(items.map((item) => item.name)).toEqual([
		"charlie",
		"delta",
		"bravo",
		"alpha",
	]);
});

it("sorts within groups only — a heavily-used skill never jumps above commands", () => {
	const items = buildSlashPickerItems(
		{ commands: ["compact", "clear"], skills: ["pdf"] },
		"",
		{ pdf: 9, clear: 1 }
	);
	expect(items).toEqual([
		{ kind: "command", name: "clear" },
		{ kind: "command", name: "compact" },
		{ kind: "skill", name: "pdf" },
	]);
});

it("keeps the reported order untouched when no usage map is provided", () => {
	const items = buildSlashPickerItems({ commands: ["bravo", "alpha"] }, "");
	expect(items.map((item) => item.name)).toEqual(["bravo", "alpha"]);
});

it("fills the composer with the command, trailing space for args, preserving prefix", () => {
	expect(applySlashPickerSelection({ kind: "command", name: "compact" })).toBe(
		"/compact "
	);
	expect(
		applySlashPickerSelection({ kind: "skill", name: "pdf" }, "fix this ")
	).toBe("fix this /pdf ");
});

it("clamps and wraps the active index around the item count", () => {
	const itemCount = 3;
	const lastIndex = itemCount - 1;
	expect(clampActiveIndex(0, itemCount)).toBe(0);
	expect(clampActiveIndex(lastIndex, itemCount)).toBe(lastIndex);
	expect(clampActiveIndex(itemCount, itemCount)).toBe(0);
	expect(clampActiveIndex(-1, itemCount)).toBe(lastIndex);
	expect(clampActiveIndex(0, 0)).toBe(0);
	expect(clampActiveIndex(-1, 0)).toBe(0);
});
