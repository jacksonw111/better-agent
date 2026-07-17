// The model can emit many tool calls in a single step, which the AI SDK runs
// concurrently with NO bound. Firing them all at once overwhelms rate-limited
// upstreams (e.g. finance-mcp → EastMoney) and the per-call MCP connect/handshake,
// so calls time out and surface as tool errors. A small semaphore caps how many
// tool executes run at once — the rest queue and run as slots free up.

// Chosen to keep genuinely-parallel work fast while staying under typical
// upstream/rate-limit and connection ceilings.
export const MAX_CONCURRENT_TOOL_CALLS = 4;

export interface Semaphore {
	/** Run `fn` once a slot is free, releasing the slot when it settles. */
	run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createSemaphore(limit: number): Semaphore {
	let active = 0;
	const queue: (() => void)[] = [];
	const release = () => {
		active -= 1;
		const next = queue.shift();
		if (next) {
			active += 1;
			next();
		}
	};
	const acquire = () =>
		new Promise<void>((resolve) => {
			if (active < limit) {
				active += 1;
				resolve();
			} else {
				queue.push(resolve);
			}
		});
	return {
		async run(fn) {
			await acquire();
			try {
				return await fn();
			} finally {
				release();
			}
		},
	};
}
