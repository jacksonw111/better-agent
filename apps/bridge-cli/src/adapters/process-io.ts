// Shared child-process plumbing for the three stdio-based adapters: spawn a
// command, expose its stdout as a line-by-line async iterable, and provide a
// `writeLine` helper for newline-delimited stdin protocols.
//
// Two failure modes matter here and are both funneled through this module so
// every adapter gets them for free:
//  - the binary isn't installed / isn't on PATH (`ENOENT`) — `spawn()` still
//    returns a `ChildProcess` synchronously in that case, and Node only
//    reports the failure asynchronously via an `error` event. Left
//    unhandled, an `error` event with no listener is a fatal uncaught
//    exception (Node's `EventEmitter` contract), so `spawnProcessIo` always
//    attaches a listener and turns it into a rejected promise with a clean
//    message instead.
//  - the process exits on its own once running (crash, or the agent simply
//    finishing) — `onExit` is the single place adapters hook to close their
//    event queues, so a relay loop never hangs waiting on an agent that's
//    already gone.
import {
	type ChildProcessWithoutNullStreams,
	execFileSync,
	spawn,
} from "node:child_process";
import { createInterface } from "node:readline";
import { createAsyncQueue } from "./async-queue";

/** Resolves a command's absolute path on PATH (`command -v`), or `undefined`
 * if it isn't installed. The standalone bridge binary doesn't bundle ANY
 * agent's CLI — every adapter drives the user's own `claude` / `opencode` /
 * `codex` / `pi` on PATH — so this powers the startup pre-flight ("is the
 * chosen agent's CLI installed?") and points claude's SDK at the user's
 * `claude` (its bundled native binary is dropped by `bun --compile`). */
export function findOnPath(command: string): string | undefined {
	let found: string | undefined;
	try {
		found =
			execFileSync("sh", ["-c", `command -v ${command}`], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim() || undefined;
	} catch {
		found = undefined;
	}
	return found;
}

export interface ProcessIo {
	child: ChildProcessWithoutNullStreams;
	/** stdout, split into lines. Completes when the process exits. */
	lines: AsyncIterable<string>;
	/**
	 * Registers a handler fired exactly once, when the process exits — whether
	 * that's a normal/abnormal exit or (for callers that raced past a spawn
	 * failure, which `spawnProcessIo` itself does not) a failed spawn. Multiple
	 * handlers may be registered; all fire in registration order.
	 */
	onExit(handler: (info: ProcessExitInfo) => void): void;
	/** stderr, split into lines (surfaced by adapters as `error` events). */
	stderrLines: AsyncIterable<string>;
	stop(): void;
	writeLine(line: string): void;
}

/** Why the process is no longer running. `error` is set when the process
 * never started at all (e.g. `ENOENT`) or died from a transport-level error;
 * otherwise `code`/`signal` mirror Node's `exit` event. */
export interface ProcessExitInfo {
	code: number | null;
	error?: Error;
	signal: NodeJS.Signals | null;
}

function describeSpawnFailure(command: string, error: NodeJS.ErrnoException) {
	const reason = error.code ?? error.message;
	// ENOENT is ambiguous: a missing binary AND a nonexistent cwd both raise it.
	return new Error(
		`failed to start "${command}": ${reason} (is "${command}" installed and on PATH? does the --dir directory exist?)`
	);
}

export function spawnProcessIo(
	command: string,
	args: string[],
	cwd: string
): Promise<ProcessIo> {
	const child = spawn(command, args, { cwd, stdio: "pipe" });

	const stdoutQueue = createAsyncQueue<string>();
	const stdoutReader = createInterface({ input: child.stdout });
	stdoutReader.on("line", (line) => stdoutQueue.push(line));

	const stderrQueue = createAsyncQueue<string>();
	const stderrReader = createInterface({ input: child.stderr });
	stderrReader.on("line", (line) => stderrQueue.push(line));

	const exitHandlers: Array<(info: ProcessExitInfo) => void> = [];
	let settled = false;

	function settleExit(info: ProcessExitInfo): void {
		if (settled) {
			return;
		}
		settled = true;
		stdoutQueue.close();
		stderrQueue.close();
		for (const handler of exitHandlers) {
			handler(info);
		}
	}

	const io: ProcessIo = {
		child,
		lines: stdoutQueue,
		stderrLines: stderrQueue,
		onExit(handler: (info: ProcessExitInfo) => void): void {
			exitHandlers.push(handler);
		},
		writeLine(line: string): void {
			child.stdin.write(`${line}\n`);
		},
		stop(): void {
			child.kill();
		},
	};

	return new Promise((resolve, reject) => {
		// `spawn` fires exactly once a process has actually started; a failed
		// spawn (e.g. ENOENT) never fires it, only `error`.
		child.once("spawn", () => resolve(io));
		child.on("error", (error: NodeJS.ErrnoException) => {
			settleExit({ code: null, signal: null, error });
			reject(describeSpawnFailure(command, error));
		});
		child.on("exit", (code, signal) => settleExit({ code, signal }));
	});
}
