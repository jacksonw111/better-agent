import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";
import { foldShellEvents, isShellEvent } from "./shell-events";

// P4-T2: the Shell tab's out-of-band `runShell` events ride the SAME feed as
// the agent's own tool calls, so two invariants must hold: they fold into
// command cards for the Shell pane (`foldShellEvents`), and they are filtered
// OUT of the chat turn feed (`foldEventsToTurns`).

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

const shellStarted = (id: string, command: string): StreamEvent["event"] => ({
	id,
	input: { command },
	kind: "tool",
	name: "shell",
	source: "runShell",
	status: "started",
});

const shellDone = (id: string, output: string): StreamEvent["event"] => ({
	id,
	kind: "tool",
	name: "shell",
	output,
	source: "runShell",
	status: "completed",
});

it("folds a started+completed pair into one settled command", () => {
	const commands = foldShellEvents([
		ev(1, shellStarted("s1", "ls")),
		ev(2, shellDone("s1", "a\nb")),
	]);
	expect(commands).toHaveLength(1);
	expect(commands[0].toolName).toBe("shell");
	expect(commands[0].status).toBe("complete");
	expect(commands[0].result).toBe("a\nb");
});

it("keeps commands in first-appearance order, one card per id", () => {
	const commands = foldShellEvents([
		ev(1, shellStarted("s1", "one")),
		ev(2, shellStarted("s2", "two")),
		ev(3, shellDone("s1", "done one")),
	]);
	expect(commands.map((tool) => tool.callId)).toEqual(["s1", "s2"]);
	expect(commands[1].status).toBe("running");
});

it("ignores ordinary (non-runShell) tool events", () => {
	const commands = foldShellEvents([
		ev(1, { id: "t1", kind: "tool", name: "Bash", status: "started" }),
	]);
	expect(commands).toHaveLength(0);
});

it("isShellEvent matches only source runShell tool events", () => {
	expect(isShellEvent(ev(1, shellStarted("s1", "ls")))).toBe(true);
	expect(
		isShellEvent(
			ev(2, { id: "t1", kind: "tool", name: "Bash", status: "started" })
		)
	).toBe(false);
	expect(
		isShellEvent(ev(3, { kind: "message", role: "user", text: "hi" }))
	).toBe(false);
});

it("filters runShell tool events out of the chat turn feed", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "message", role: "user", text: "hi" }),
		ev(2, shellStarted("s1", "ls")),
		ev(3, shellDone("s1", "a\nb")),
	]);
	// Only the user turn survives — the shell command never renders as chat.
	expect(turns).toHaveLength(1);
	expect(turns[0].kind).toBe("user");
});

it("does not fragment an in-flight assistant bubble when a shell command runs mid-turn", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "Hel" }),
		ev(2, shellStarted("s1", "ls")),
		ev(3, shellDone("s1", "ok")),
		ev(4, { kind: "output", text: "lo" }),
	]);
	// One assistant turn, both deltas merged — the shell event is transparent.
	expect(turns).toHaveLength(1);
	expect(turns[0].kind).toBe("assistant");
});
