// @vitest-environment jsdom
import type { MessageHistory } from "@jacksonw111/agent-client";
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { hasRunningTurn, useObserveTurn } from "./chat-observe";

function rows(role: string, status: string): MessageHistory {
	return [
		{ message: { id: "m", role, status }, parts: [] },
	] as unknown as MessageHistory;
}

it("hasRunningTurn is true only for a trailing streaming assistant", () => {
	expect(hasRunningTurn(rows("assistant", "streaming"))).toBe(true);
	expect(hasRunningTurn(rows("assistant", "complete"))).toBe(false);
	expect(hasRunningTurn(rows("user", "streaming"))).toBe(false);
	expect(hasRunningTurn([])).toBe(false);
	expect(hasRunningTurn(undefined)).toBe(false);
});

// biome-ignore lint/suspicious/useAwait: test async generator
async function* liveThenClose(events: number) {
	for (let i = 0; i < events; i++) {
		yield {};
	}
}

it("refetches once when the observed turn closes and clears observing", async () => {
	const refetch = vi.fn();
	const observe = () => liveThenClose(0); // no events → closes immediately
	const { result } = renderHook(() =>
		useObserveTurn(observe, "s1", true, refetch)
	);
	await waitFor(() => expect(refetch).toHaveBeenCalled());
	await waitFor(() => expect(result.current).toBe(false)); // observing settled
});

it("does not subscribe when disabled or no observe fn", async () => {
	const observe = vi.fn(() => liveThenClose(0));
	renderHook(() => useObserveTurn(observe, "s1", false, () => undefined));
	await waitFor(() => expect(observe).not.toHaveBeenCalled());
});
