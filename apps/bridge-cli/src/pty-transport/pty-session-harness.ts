import type { PtyFrame } from "@better-agent/api/pty/frame";
import { decodeFrame } from "@better-agent/api/pty/frame-decode";
import { vi } from "vitest";
import type { PtyHandle } from "../pty/spawn-pty";
import {
	createPtySessionManager,
	type PtySpawnFn,
} from "./pty-session-manager";

// Shared in-memory harness for the pty session-manager tests: a fake pty whose
// output/exit the test drives, a pass-through coalescer (no timers), and a
// `setup` that wires them into a manager and records everything it sends —
// decoded (`sent`) and raw (`raw`, for header-only frames like LIVENESS).

export const SID = "0f8fad5b-d9cb-469f-a165-70867728950e";
export const SPEC = { command: "cat", args: [], cwd: "/tmp" };

export function bytes(str: string): Uint8Array {
	return new TextEncoder().encode(str);
}

export function createFakePty() {
	let dataCb: ((chunk: Uint8Array) => void) | null = null;
	let exitCb: ((exit: { code: number | null }) => void) | null = null;
	const handle = {
		onData: (cb: (chunk: Uint8Array) => void) => {
			dataCb = cb;
		},
		onExit: (cb: (exit: { code: number | null }) => void) => {
			exitCb = cb;
		},
		write: vi.fn(),
		resize: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		kill: vi.fn(),
		pid: 1,
	} as unknown as PtyHandle & {
		write: ReturnType<typeof vi.fn>;
		resize: ReturnType<typeof vi.fn>;
		pause: ReturnType<typeof vi.fn>;
		resume: ReturnType<typeof vi.fn>;
		kill: ReturnType<typeof vi.fn>;
	};
	return {
		handle,
		emitData: (chunk: Uint8Array) => dataCb?.(chunk),
		emitExit: (code: number | null) => exitCb?.({ code }),
	};
}

/** A pass-through coalescer so DATA routing is observable without timers. */
function syncCoalescer(onFlush: (m: Uint8Array) => void) {
	return {
		push: (chunk: Uint8Array) => onFlush(chunk),
		flush: () => undefined,
		dispose: () => undefined,
	};
}

export interface SetupOverrides {
	activityThrottleMs?: number;
	highWaterBytes?: number;
	lowWaterBytes?: number;
	now?: () => number;
}

export function setup(overrides: SetupOverrides = {}) {
	const fake = createFakePty();
	const spawn = vi.fn(() => fake.handle) as unknown as PtySpawnFn;
	const sent: PtyFrame[] = [];
	const raw: Uint8Array[] = [];
	const manager = createPtySessionManager({
		send: (frame) => {
			raw.push(frame);
			const decoded = decodeFrame(frame);
			if (decoded) {
				sent.push(decoded);
			}
		},
		spawn,
		makeCoalescer: syncCoalescer,
		...overrides,
	});
	const feed = (frame: Uint8Array) => {
		const decoded = decodeFrame(frame);
		if (decoded) {
			manager.handleFrame(decoded);
		}
	};
	return { fake, spawn, sent, raw, manager, feed };
}
