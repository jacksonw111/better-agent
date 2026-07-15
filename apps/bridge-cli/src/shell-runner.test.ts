import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ToolEvent } from "./normalize/types";
import { createShellRunner, withShellRunner } from "./shell-runner";

// A minimal stand-in for a spawned child: stdout/stderr are emitters the test
// drives, and `close`/`error` are emitted on the child itself.
class FakeChild extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	pid = 4242;
	kill = vi.fn(() => true);
}

function setup() {
	const child = new FakeChild();
	const spawnImpl = vi.fn(
		() => child
	) as unknown as typeof import("node:child_process").spawn;
	const events: ToolEvent[] = [];
	const runner = createShellRunner({
		dir: "/work",
		pushEvent: (event) => events.push(event as ToolEvent),
		spawnImpl,
		timeoutMs: 60_000,
	});
	return { child, events, runner, spawnImpl };
}

// Returns the first matching event, throwing (test failure) when absent, so
// destructured results are non-optional under noUncheckedIndexedAccess.
function byStatus(
	events: ToolEvent[],
	status: ToolEvent["status"]
): [ToolEvent] {
	const matched = events.filter((event) => event.status === status);
	const first = matched[0];
	if (!first) {
		throw new Error(`no ${status} event emitted`);
	}
	return [first];
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(process, "kill").mockImplementation(() => true);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("spawns sh -c in the workspace dir with no inherited stdio", () => {
	const { runner, spawnImpl } = setup();
	runner.run("echo hi");
	expect(spawnImpl).toHaveBeenCalledWith("sh", ["-c", "echo hi"], {
		cwd: "/work",
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
});

it("emits a started event marked source runShell with the command", () => {
	const { events, runner } = setup();
	runner.run("ls -la");
	const started = events[0];
	expect(started).toMatchObject({
		input: { command: "ls -la" },
		kind: "tool",
		name: "shell",
		source: "runShell",
		status: "started",
	});
});

it("streams a throttled preview then a completed event on exit 0", () => {
	const { child, events, runner } = setup();
	runner.run("echo hi");
	child.stdout.emit("data", Buffer.from("hello\n"));
	vi.advanceTimersByTime(500);
	const preview = events.find((event) => event.preview !== undefined);
	expect(preview?.preview).toBe("hello\n");
	child.emit("close", 0, null);
	const [done] = byStatus(events, "completed");
	expect(done.output).toContain("hello");
	expect(done.output).toContain("[shell: exit code 0]");
	expect(typeof done.durationMs).toBe("number");
});

it("merges stderr into the output and fails on a nonzero exit", () => {
	const { child, events, runner } = setup();
	runner.run("false");
	child.stderr.emit("data", Buffer.from("boom\n"));
	child.emit("close", 1, null);
	const [failed] = byStatus(events, "failed");
	expect(failed.output).toContain("boom");
	expect(failed.output).toContain("[shell: exit code 1]");
});

it("kills the process group and fails the event on timeout", () => {
	const { child, events, runner } = setup();
	runner.run("sleep 999");
	vi.advanceTimersByTime(60_000);
	expect(process.kill).toHaveBeenCalledWith(-4242, "SIGKILL");
	child.emit("close", null, "SIGKILL");
	const [failed] = byStatus(events, "failed");
	expect(failed.output).toContain("timed out after 60s");
});

it("withShellRunner adds a runShell method that spawns", () => {
	const child = new FakeChild();
	const spawnImpl = vi.fn(
		() => child
	) as unknown as typeof import("node:child_process").spawn;
	const base = { send: vi.fn(), stop: vi.fn() };
	const wrapped = withShellRunner(base, {
		dir: "/work",
		pushEvent: vi.fn(),
		spawnImpl,
	});
	wrapped.runShell("pwd");
	expect(spawnImpl).toHaveBeenCalledTimes(1);
	// The wrapped handle still inherits the base handle's own methods.
	expect(wrapped.send).toBe(base.send);
});
