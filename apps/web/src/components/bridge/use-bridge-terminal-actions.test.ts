// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionControls } from "./use-bridge-terminal-actions";

// Focused coverage for `restart` — the one control in this file that's a
// distinct `bridge.restartSession` server procedure rather than a `{ type:
// "control", ... }` message relayed over `sendRaw` (see the doc comment on
// `restartSession` in use-bridge-terminal-actions.ts).

const store = vi.hoisted(() => ({
	restartCalls: [] as Record<string, unknown>[],
	restartImpl: () => Promise.resolve({ ok: true as const }),
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		bridge: {
			restartSession: {
				call: (input: Record<string, unknown>) => {
					store.restartCalls.push(input);
					return store.restartImpl();
				},
			},
		},
	},
}));

afterEach(() => {
	store.restartCalls.length = 0;
	store.restartImpl = () => Promise.resolve({ ok: true as const });
	vi.clearAllMocks();
});

it("restart() invokes bridge.restartSession with the session's id", async () => {
	const sendRaw = vi.fn().mockResolvedValue(undefined);
	const { result } = renderHook(() =>
		useSessionControls(sendRaw, "session-42")
	);

	await result.current.restart();

	expect(store.restartCalls).toEqual([{ sessionId: "session-42" }]);
	// Restart is a distinct server procedure, never relayed over `sendRaw`
	// like interrupt/setModel/etc.
	expect(sendRaw).not.toHaveBeenCalled();
});

it("toasts and resolves (rather than rejects) when the restart request fails", async () => {
	store.restartImpl = () => Promise.reject(new Error("relay unavailable"));
	const { toast } = await import("sonner");
	const sendRaw = vi.fn().mockResolvedValue(undefined);
	const { result } = renderHook(() => useSessionControls(sendRaw, "session-1"));

	await expect(result.current.restart()).resolves.toBeUndefined();

	expect(toast.error).toHaveBeenCalledWith("relay unavailable");
});
