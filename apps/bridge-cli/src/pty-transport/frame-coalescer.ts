// DP-PTY5: coalesce a burst of small pty writes into one DATA frame per ~8–16ms
// window. A TUI that repaints byte-by-byte would otherwise produce a frame per
// keystroke-echo; batching them keeps the wire (and the web xterm) from
// drowning in tiny frames. A window is also flushed early once it reaches
// `maxBytes`, so a fast producer never buffers unboundedly waiting for the timer.

export const DEFAULT_COALESCE_WINDOW_MS = 12;
export const DEFAULT_COALESCE_MAX_BYTES = 64 * 1024;

export interface FrameCoalescerConfig {
	clearTimer?: (handle: unknown) => void;
	maxBytes?: number;
	/** Emits one merged buffer per window. */
	onFlush: (merged: Uint8Array) => void;
	setTimer?: (fn: () => void, ms: number) => unknown;
	windowMs?: number;
}

export interface FrameCoalescer {
	/** Cancels a pending window without flushing (session teardown). */
	dispose(): void;
	/** Forces the current window out immediately (e.g. before CLOSE). */
	flush(): void;
	/** Queues a chunk into the current window. */
	push(chunk: Uint8Array): void;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
	const merged = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		merged.set(chunk, at);
		at += chunk.length;
	}
	return merged;
}

export function createFrameCoalescer(
	config: FrameCoalescerConfig
): FrameCoalescer {
	const windowMs = config.windowMs ?? DEFAULT_COALESCE_WINDOW_MS;
	const maxBytes = config.maxBytes ?? DEFAULT_COALESCE_MAX_BYTES;
	const setTimer = config.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
	const clearTimer =
		config.clearTimer ?? ((handle) => clearTimeout(handle as never));

	let chunks: Uint8Array[] = [];
	let total = 0;
	let timer: unknown = null;

	function flush(): void {
		if (timer !== null) {
			clearTimer(timer);
			timer = null;
		}
		if (total === 0) {
			return;
		}
		const merged = concat(chunks, total);
		chunks = [];
		total = 0;
		config.onFlush(merged);
	}

	return {
		flush,
		dispose() {
			if (timer !== null) {
				clearTimer(timer);
				timer = null;
			}
			chunks = [];
			total = 0;
		},
		push(chunk) {
			if (chunk.length === 0) {
				return;
			}
			chunks.push(chunk);
			total += chunk.length;
			if (total >= maxBytes) {
				flush();
				return;
			}
			if (timer === null) {
				timer = setTimer(flush, windowMs);
			}
		},
	};
}
