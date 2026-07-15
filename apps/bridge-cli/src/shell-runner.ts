// P4-T2: the CLI-GLOBAL out-of-band shell runner. A `runShell` control command
// from the web spawns a ONE-SHOT `sh -c <command>` in the agent's workspace
// (cwd = the CLI's `args.dir`) and streams its merged stdout/stderr back to the
// web as normalized `tool` events named "shell" (marked `source: "runShell"`)
// — so the web's existing Bash command card renders it, and its own Shell tab
// picks it out of the feed while the chat pane filters it out. Crucially this
// NEVER touches the agent: it's a wrapper added to the `CommandSink` at the
// same seam image-input.ts / restart-loop.ts wrap the handle, not per-adapter
// code. Interactive pty is explicitly phase 2 — this is a fire-and-forget,
// timeout-bounded, output-capped single command only.

import { type ChildProcess, spawn } from "node:child_process";
import type { ToolEvent } from "./normalize/types";
import { truncateEvent } from "./truncate-event";

/** Hard wall-clock cap on a single command; on expiry the whole process group
 * is killed (see `killGroup`) and the event settles `failed`. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Memory bound on collected output — tail-kept (oldest chunks dropped first).
 * The final event is separately shrunk to `MAX_EVENT_TEXT_CHARS` by
 * `truncateEvent` before it's pushed, so this only bounds in-process memory. */
const MAX_OUTPUT_BYTES = 64 * 1024;
/** Streaming-preview push cadence while the command runs — a running `tool`
 * event carries the latest partial output (REPLACE semantics) at most this
 * often, so a chatty command doesn't flood the relay. */
const PREVIEW_THROTTLE_MS = 500;

export interface ShellRunnerDeps {
	/** The workspace directory every command runs in (the CLI's validated
	 * `args.dir`); never the CLI's own cwd, and never caller-supplied. */
	dir: string;
	/** Injectable clock for deterministic `durationMs` in tests. */
	now?: () => number;
	/** Best-effort push of one normalized event straight to the relay
	 * (fire-and-forget, same contract as image-input.ts's `pushStatus`) — these
	 * events are out-of-band, not part of the agent's own `events` stream. */
	pushEvent: (event: unknown) => void;
	/** Injectable for tests; defaults to `node:child_process`'s `spawn`. */
	spawnImpl?: typeof spawn;
	timeoutMs?: number;
}

interface ExitResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
}

/** A tail-capped byte buffer: `append` keeps only the most recent
 * `MAX_OUTPUT_BYTES`, dropping whole oldest chunks first so a runaway command
 * can't exhaust memory. */
function createTailBuffer(): {
	append: (chunk: Buffer) => void;
	text: () => string;
} {
	const chunks: Buffer[] = [];
	let bytes = 0;
	return {
		append: (chunk: Buffer) => {
			chunks.push(chunk);
			bytes += chunk.length;
			while (bytes > MAX_OUTPUT_BYTES && chunks.length > 1) {
				const dropped = chunks.shift();
				if (dropped) {
					bytes -= dropped.length;
				}
			}
		},
		text: () => Buffer.concat(chunks).toString("utf8"),
	};
}

/** A short exit-status footer appended to the collected output so the web's
 * command card shows how the command ended even when it produced no output. */
function exitFooter(result: ExitResult): string {
	if (result.timedOut) {
		return `\n[shell: timed out after ${DEFAULT_TIMEOUT_MS / 1000}s]`;
	}
	if (result.signal) {
		return `\n[shell: killed by ${result.signal}]`;
	}
	return `\n[shell: exit code ${result.code ?? 0}]`;
}

/** Kills the child's whole process group (spawned detached), so a command that
 * itself forked children doesn't leave orphans behind. Falls back to killing
 * just the child if the group kill throws (e.g. it already exited). */
function killGroup(child: ChildProcess): void {
	if (child.pid === undefined) {
		return;
	}
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

interface CommandDeps {
	now: () => number;
	pushEvent: (event: unknown) => void;
}

/** The invariant half of every runShell tool event — id/input/kind/name/source
 * — merged under the per-emit fields (status, preview, output, durationMs). */
function shellToolEvent(
	id: string,
	command: string,
	rest: Partial<ToolEvent> & { status: ToolEvent["status"] }
): ToolEvent {
	return {
		id,
		input: { command },
		kind: "tool",
		name: "shell",
		source: "runShell",
		...rest,
	};
}

/** One in-flight command's emit helpers, bound to its stable id — a closure
 * over the tail buffer + settled/preview-timer state (no class, to stay clear
 * of the repo's no-parameter-properties lint). */
function createCommand(deps: CommandDeps, id: string, command: string) {
	const buffer = createTailBuffer();
	const startedAt = deps.now();
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	let settled = false;
	const emit = (rest: Partial<ToolEvent> & { status: ToolEvent["status"] }) =>
		deps.pushEvent(truncateEvent(shellToolEvent(id, command, rest)));
	return {
		onData: (chunk: Buffer) => {
			buffer.append(chunk);
			if (previewTimer === undefined) {
				previewTimer = setTimeout(() => {
					previewTimer = undefined;
					if (!settled) {
						emit({ preview: buffer.text(), status: "started" });
					}
				}, PREVIEW_THROTTLE_MS);
			}
		},
		settle: (result: ExitResult) => {
			if (settled) {
				return;
			}
			settled = true;
			if (previewTimer !== undefined) {
				clearTimeout(previewTimer);
				previewTimer = undefined;
			}
			const ok =
				!result.timedOut && result.signal === null && result.code === 0;
			emit({
				durationMs: deps.now() - startedAt,
				output: `${buffer.text()}${exitFooter(result)}`,
				status: ok ? "completed" : "failed",
			});
		},
		start: () => emit({ status: "started" }),
	};
}

type Command = ReturnType<typeof createCommand>;

/** Wires a spawned child's stdout/stderr/exit/error to `cmd` and arms the
 * timeout — all outcomes settle through `cmd.settle`. */
function driveChild(
	child: ChildProcess,
	cmd: Command,
	timeoutMs: number
): void {
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		killGroup(child);
	}, timeoutMs);
	child.stdout?.on("data", (chunk: Buffer) => cmd.onData(chunk));
	child.stderr?.on("data", (chunk: Buffer) => cmd.onData(chunk));
	child.on("error", (error: Error) => {
		clearTimeout(timer);
		cmd.onData(Buffer.from(`${error.message}\n`));
		cmd.settle({ code: null, signal: null, timedOut });
	});
	child.on("close", (code, signal) => {
		clearTimeout(timer);
		cmd.settle({ code, signal, timedOut });
	});
}

/** Creates the runner: `run(command)` spawns one detached `sh -c command` in
 * `deps.dir` with NO inherited stdio, streams its output as `runShell` tool
 * events, and settles on exit/timeout. */
export function createShellRunner(deps: ShellRunnerDeps): {
	run: (command: string) => void;
} {
	const now = deps.now ?? Date.now;
	const spawnImpl = deps.spawnImpl ?? spawn;
	const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let counter = 0;
	return {
		run: (command: string) => {
			counter += 1;
			const id = `shell-${now()}-${counter}`;
			const cmd = createCommand(
				{ now, pushEvent: deps.pushEvent },
				id,
				command
			);
			cmd.start();
			const child = spawnImpl("sh", ["-c", command], {
				cwd: deps.dir,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			driveChild(child, cmd, timeoutMs);
		},
	};
}

/** Adds a `runShell` method to `handle` so the `CommandSink` dispatch can route
 * the web's out-of-band shell command to the runner. The runner doesn't depend
 * on the handle at all — this wrapper only exists so `runShell` lands on the
 * same object the poll/duplex loops dispatch commands into. Spreads (mirrors
 * image-input.ts's `withImageInput`) rather than `Object.create`, so every
 * inherited method stays an OWN enumerable property: `session-watchdog-
 * wiring.ts`'s `watchdogSink` re-wraps the poll sink with `{...handle}`, which
 * would silently drop any method living only on a prototype. */
export function withShellRunner<H extends object>(
	handle: H,
	deps: ShellRunnerDeps
): H & { runShell(command: string): void } {
	const runner = createShellRunner(deps);
	return {
		...handle,
		runShell: (command: string) => runner.run(command),
	};
}
