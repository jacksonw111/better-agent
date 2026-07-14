import type { BridgeSessionRow } from "@better-agent/agent/ports";
import { beforeEach, expect, it, vi } from "vitest";
import type { Context } from "../context";
import {
	__resetOwnedBridgeSessionCacheForTests,
	requireOwnedBridgeSession,
} from "./ownership";

function row(overrides: Partial<BridgeSessionRow> = {}): BridgeSessionRow {
	return {
		id: "sess-1",
		userId: "alice",
		tokenId: "tok-1",
		agentKind: "claude-code",
		label: null,
		name: null,
		agentSessionId: null,
		status: "active",
		createdAt: new Date(),
		lastSeenAt: new Date(),
		archivedAt: null,
		starred: false,
		vncEndpoint: null,
		...overrides,
	};
}

function contextWith(get: (id: string) => Promise<BridgeSessionRow | null>): {
	context: Context;
	get: ReturnType<typeof vi.fn>;
} {
	const spy = vi.fn(get);
	const context = {
		services: { stores: { bridgeSession: { get: spy } } },
	} as unknown as Context;
	return { context, get: spy };
}

beforeEach(() => {
	__resetOwnedBridgeSessionCacheForTests();
});

it("resolves for the owning user on a cache miss, hitting the store", async () => {
	const { context, get } = contextWith((id) => Promise.resolve(row({ id })));

	await expect(
		requireOwnedBridgeSession(context, "alice", "sess-1")
	).resolves.toBeUndefined();
	expect(get).toHaveBeenCalledTimes(1);
});

it("throws NOT_FOUND for a non-owner and does not cache the mismatch", async () => {
	const { context, get } = contextWith((id) => Promise.resolve(row({ id })));

	await expect(
		requireOwnedBridgeSession(context, "bob", "sess-1")
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expect(get).toHaveBeenCalledTimes(1);
});

it("throws NOT_FOUND for a missing session", async () => {
	const { context, get } = contextWith(() => Promise.resolve(null));

	await expect(
		requireOwnedBridgeSession(context, "alice", "missing")
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expect(get).toHaveBeenCalledTimes(1);
});

it("a second call for the same session skips the store (cache hit)", async () => {
	const { context, get } = contextWith((id) => Promise.resolve(row({ id })));

	await requireOwnedBridgeSession(context, "alice", "sess-1");
	await requireOwnedBridgeSession(context, "alice", "sess-1");

	expect(get).toHaveBeenCalledTimes(1);
});

it("a cache hit still enforces ownership for a different caller", async () => {
	const { context, get } = contextWith((id) => Promise.resolve(row({ id })));

	await requireOwnedBridgeSession(context, "alice", "sess-1");
	await expect(
		requireOwnedBridgeSession(context, "bob", "sess-1")
	).rejects.toMatchObject({ code: "NOT_FOUND" });

	// The mismatch was resolved from cache — no second store hit.
	expect(get).toHaveBeenCalledTimes(1);
});
