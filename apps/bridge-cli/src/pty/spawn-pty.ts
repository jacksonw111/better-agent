// spawnPty — the clean PTY interface the transport layer (P2-1) builds on.
//
// It owns a pty-broker child process (native/pty-broker.c) and wires its fds:
//   - stdin (fd0)  ← write():   keystrokes into the pty
//   - stdout (fd1) → onData():  raw pty output bytes
//   - ctrl-in (fd3) ← resize(): a 4-byte {rows:u16,cols:u16} LE frame
//   - ctrl-out (fd4)→ onExit(): the broker's one-byte resolved exit status
//
// The broker (not this module) holds the real pty via forkpty and does the
// TIOCSWINSZ ioctl, so nothing here touches bun:ffi — the reason this works
// under `bun build --compile` at all (see the node-pty/Bun spike).

import { type ChildProcess, spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { resolveBrokerPath } from "./resolve-broker";

const RESIZE_FRAME_LEN = 4;
const MAX_U16 = 0xff_ff;

/** Clamps a terminal dimension to the u16 range the wire frame allows. */
function clampU16(n: number): number {
	return Math.max(0, Math.min(MAX_U16, Math.trunc(n)));
}

export interface PtyExit {
	/** Resolved exit status: the process exit code, or 128+signum if signalled.
	 * Prefers the broker's fd4 byte, falling back to the child's exit code. */
	code: number | null;
	/** The POSIX signal name that killed the broker, if any. */
	signal: NodeJS.Signals | null;
}

export interface PtyHandle {
	/** Terminate the session; the broker forwards the signal to the child's
	 * process group so no orphans survive. Defaults to SIGTERM. */
	kill(signal?: NodeJS.Signals): void;
	/** Subscribe to raw pty output. Multiple subscribers are supported. */
	onData(cb: (data: Buffer) => void): void;
	/** Subscribe to broker/child exit. Fires exactly once. */
	onExit(cb: (exit: PtyExit) => void): void;
	/** Stop reading pty output — the broker's stdout pipe fills and the child
	 * blocks on write (natural pty backpressure). Used by the transport's flow
	 * control (DP-PTY4) when a viewer falls behind. Idempotent. */
	pause(): void;
	/** The underlying broker process id (for diagnostics/tests). */
	readonly pid: number | undefined;
	/** Resize the pty (cols, rows) — triggers SIGWINCH in the child. */
	resize(cols: number, rows: number): void;
	/** Resume reading pty output after `pause()`. Idempotent. */
	resume(): void;
	/** Write bytes (keystrokes) into the pty. */
	write(data: Buffer | string): void;
}

/** Injectable seams for tests (fake spawn, explicit broker path) plus the
 * spawn environment. `env` overrides the child's environment — used to strip
 * claude's child-session markers before a claude/pi spawn (P25-C); when
 * omitted the broker inherits the CLI's own `process.env`. */
export interface SpawnPtyDeps {
	brokerPath?: string;
	env?: NodeJS.ProcessEnv;
	spawnImpl?: typeof spawn;
}

/** Encodes a {rows,cols} resize into the broker's 4-byte little-endian frame. */
function resizeFrame(cols: number, rows: number): Buffer {
	const frame = Buffer.alloc(RESIZE_FRAME_LEN);
	frame.writeUInt16LE(clampU16(rows), 0);
	frame.writeUInt16LE(clampU16(cols), 2);
	return frame;
}

/** fd0=stdin, fd1=stdout, fd2=inherited stderr (broker diagnostics),
 * fd3=resize ctrl-in, fd4=exit ctrl-out. */
const BROKER_STDIO = ["pipe", "pipe", "inherit", "pipe", "pipe"] as const;

/** Wires the broker's exit reporting: capture the fd4 exit byte, then fire the
 * exit callbacks exactly once on child exit/error (fd4 byte preferred). */
function attachExit(
	child: ChildProcess,
	exitCbs: Array<(exit: PtyExit) => void>
): void {
	let exitByte: number | undefined;
	let exited = false;
	// fd4: the broker writes exactly one byte (its resolved exit status) just
	// before exiting; capture it so onExit reports a signalled child's status.
	const ctrlOut = child.stdio[4];
	if (ctrlOut && typeof (ctrlOut as NodeJS.ReadableStream).on === "function") {
		(ctrlOut as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			if (chunk.length > 0) {
				exitByte = chunk[0];
			}
		});
	}
	const settle = (code: number | null, signal: NodeJS.Signals | null) => {
		if (exited) {
			return;
		}
		exited = true;
		for (const cb of exitCbs) {
			cb({ code: exitByte ?? code, signal });
		}
	};
	child.on("exit", (code, signal) => settle(code, signal));
	child.on("error", () => settle(null, null));
}

/** Wires a spawned broker child's fds into the PtyHandle contract. */
function wrapBroker(child: ChildProcess): PtyHandle {
	const dataCbs: Array<(data: Buffer) => void> = [];
	const exitCbs: Array<(exit: PtyExit) => void> = [];

	child.stdout?.on("data", (chunk: Buffer) => {
		for (const cb of dataCbs) {
			cb(chunk);
		}
	});
	attachExit(child, exitCbs);

	const ctrlIn = child.stdio[3] as Writable | null | undefined;

	return {
		get pid() {
			return child.pid;
		},
		onData: (cb) => {
			dataCbs.push(cb);
		},
		onExit: (cb) => {
			exitCbs.push(cb);
		},
		write: (data) => {
			child.stdin?.write(data);
		},
		resize: (cols2, rows2) => {
			ctrlIn?.write(resizeFrame(cols2, rows2));
		},
		pause: () => {
			child.stdout?.pause();
		},
		resume: () => {
			child.stdout?.resume();
		},
		kill: (signal: NodeJS.Signals = "SIGTERM") => {
			child.kill(signal);
		},
	};
}

/**
 * Spawns `command args...` inside a fresh pty via the broker.
 *
 * @param command  program to run in the pty (e.g. "claude" or "bash")
 * @param args     its arguments
 * @param cwd      working directory for the pty session
 * @param cols     initial terminal columns
 * @param rows     initial terminal rows
 */
export function spawnPty(
	command: string,
	args: string[],
	cwd: string,
	cols: number,
	rows: number,
	deps: SpawnPtyDeps = {}
): PtyHandle {
	const spawnImpl = deps.spawnImpl ?? spawn;
	const brokerPath = deps.brokerPath ?? resolveBrokerPath();
	const child = spawnImpl(
		brokerPath,
		[String(rows), String(cols), command, ...args],
		// `env: undefined` makes node inherit the parent env (the default); a
		// cleaned env is passed only for claude/pi (see agent-command.ts).
		{ cwd, env: deps.env, stdio: [...BROKER_STDIO] }
	);
	return wrapBroker(child);
}
