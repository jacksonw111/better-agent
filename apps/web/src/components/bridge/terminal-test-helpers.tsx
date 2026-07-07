import { waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { BridgeSessionRow } from "@/utils/api-types";
import type { BridgeTransport, ConnectStreamArgs } from "./bridge-transport";

/** Shared fixtures/helpers for terminal.test.tsx and terminal-approval.test.tsx
 * — split across two files so neither trips the repo's max-lines-per-file
 * gate, but both drive the same `Terminal` component against the same fake
 * transport shape. Not itself a `*.test.*` file, so vitest's include glob
 * skips it. */

export const SESSION: BridgeSessionRow = {
	id: "session-1",
	userId: "user-1",
	tokenId: "token-1",
	agentKind: "claude-code",
	agentSessionId: null,
	label: "my-repo",
	status: "active",
	createdAt: new Date("2026-07-04T00:00:00Z"),
	lastSeenAt: new Date("2026-07-04T00:00:00Z"),
};

export const OTHER_SESSION: BridgeSessionRow = { ...SESSION, id: "session-2" };

export const ENDED_SESSION: BridgeSessionRow = {
	...SESSION,
	id: "session-ended",
	status: "ended",
};

/** A `pi` session — used by capability-gating tests (see
 * agent-capabilities.ts) to exercise the reduced surface: no "Past
 * conversations", a default/plan-only permission-mode dropdown, and no usage
 * chip (pi only polls for usage, it doesn't stream it). */
export const PI_SESSION: BridgeSessionRow = {
	...SESSION,
	id: "session-pi",
	agentKind: "pi",
};

/** A `codex` session — the conservative matrix (see agent-capabilities.ts):
 * only reasoning and interrupt on, everything else off until codex is
 * installed and verified. */
export const CODEX_SESSION: BridgeSessionRow = {
	...SESSION,
	id: "session-codex",
	agentKind: "codex",
};

export function statusRaw(id: number, status: string) {
	return { id, data: { kind: "status", status } };
}

/** A curated `session_ready` status event, as the CLI's normalize layer
 * emits it on session init — see bridge-session-status.ts. */
export function sessionReadyRaw(id: number, detail: Record<string, unknown>) {
	return { id, data: { kind: "status", status: "session_ready", detail } };
}

/** A curated `turn_usage` status event, emitted once per completed turn. */
export function turnUsageRaw(id: number, detail: Record<string, unknown>) {
	return { id, data: { kind: "status", status: "turn_usage", detail } };
}

export function approvalRaw(id: number, requestId: string) {
	return {
		id,
		data: {
			kind: "approval",
			requestId,
			title: "Run `rm -rf tmp/`?",
			detail: "Requested by the agent's shell tool.",
			options: [
				{ id: "allow", label: "Allow" },
				{ id: "deny", label: "Deny" },
			],
		},
	};
}

export const EVENT_TEXT_PATTERN = /starting|thinking|done/;
export const ALLOW_BUTTON_PATTERN = /Allow/;
export const DENY_BUTTON_PATTERN = /Deny/;
export const ALLOW_CHOSEN_BUTTON_PATTERN = /Allow.*chosen/;

// A transport whose `connectStream` opens immediately and hands the caller
// its handlers, so a test can drive events (or failures) by hand. `history`
// defaults to an empty backlog — the terminal's history-seed effect always
// runs on mount, and the live SSE/poll connection only opens once it
// settles (see useHistorySeed), so most tests must wait past it via
// `waitForConnect` before touching `current()`.
export function makeControllableTransport() {
	let latest: ConnectStreamArgs | null = null;
	const connectCalls: ConnectStreamArgs[] = [];
	const sendInput = vi.fn().mockResolvedValue(undefined);
	const observe = vi.fn().mockResolvedValue([]);
	const history = vi.fn().mockResolvedValue([]);
	const transport: BridgeTransport = {
		connectStream: (args) => {
			latest = args;
			connectCalls.push(args);
			return () => {
				// unsubscribe: no-op for this fake
			};
		},
		history,
		observe,
		sendInput,
	};
	return {
		transport,
		sendInput,
		observe,
		history,
		connectCalls,
		current: () => latest,
	};
}

/** Waits for the history-seed effect to settle and the live SSE connection to
 * open — the point at which `fake.current()` first becomes non-null. Every
 * test that drives the fake stream by hand (`onOpen`/`onEvent`/`onError`)
 * must await this first, since those calls no-op silently against a `null`
 * connection. */
export async function waitForConnect(
	fake: ReturnType<typeof makeControllableTransport>
): Promise<void> {
	await waitFor(() => {
		expect(fake.current()).not.toBeNull();
	});
}
