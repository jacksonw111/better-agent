import { expect, it } from "vitest";
import { mapHookEventToState } from "./hook-state";

it("maps SessionStart to starting", () => {
	expect(mapHookEventToState("SessionStart")).toBe("starting");
});

it("maps the in-turn events to working", () => {
	expect(mapHookEventToState("UserPromptSubmit")).toBe("working");
	expect(mapHookEventToState("PreToolUse")).toBe("working");
	expect(mapHookEventToState("PostToolUse")).toBe("working");
	expect(mapHookEventToState("SubagentStop")).toBe("working");
});

it("maps Stop to idle — the turn-complete signal", () => {
	expect(mapHookEventToState("Stop")).toBe("idle");
});

it("maps Notification conservatively to idle", () => {
	expect(mapHookEventToState("Notification")).toBe("idle");
});

it("maps SessionEnd to ended", () => {
	expect(mapHookEventToState("SessionEnd")).toBe("ended");
});

it("returns undefined for an unknown event (version tolerance)", () => {
	expect(mapHookEventToState("SomeFutureEvent")).toBeUndefined();
	expect(mapHookEventToState("")).toBeUndefined();
});
