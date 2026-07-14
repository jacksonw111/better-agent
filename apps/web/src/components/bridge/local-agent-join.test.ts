import { expect, it } from "vitest";
import type { BridgeSessionRow, BridgeTokenRow } from "@/utils/api-types";
import { deriveLocalAgentEntries } from "./local-agent-join";
import { LOCAL_AGENT_LIVE_THRESHOLD_MS } from "./local-agent-status";

const NOW = new Date("2026-07-04T12:00:00Z");

function makeToken(overrides: Partial<BridgeTokenRow> = {}): BridgeTokenRow {
	return {
		id: "token-1",
		userId: "user-1",
		name: "My laptop",
		agentKind: "claude-code",
		token: "bt_token",
		last4: "abcd",
		config: null,
		createdAt: NOW,
		revokedAt: null,
		...overrides,
	};
}

function makeSession(
	overrides: Partial<BridgeSessionRow> = {}
): BridgeSessionRow {
	return {
		id: "session-1",
		userId: "user-1",
		tokenId: "token-1",
		agentKind: "claude-code",
		agentSessionId: null,
		label: null,
		status: "active",
		createdAt: NOW,
		lastSeenAt: NOW,
		vncEndpoint: null,
		attention: null,
		...overrides,
	};
}

it("picks the session with the later createdAt, regardless of array order", () => {
	const token = makeToken();
	const older = makeSession({
		id: "session-old",
		createdAt: new Date("2026-07-01T00:00:00Z"),
	});
	const newer = makeSession({
		id: "session-new",
		createdAt: new Date("2026-07-03T00:00:00Z"),
	});

	const entries = deriveLocalAgentEntries([token], [older, newer], NOW);

	expect(entries).toHaveLength(1);
	expect(entries[0]?.latestSession?.id).toBe("session-new");
});

it("is not-connected when the token has no sessions", () => {
	const token = makeToken();

	const entries = deriveLocalAgentEntries([token], [], NOW);

	expect(entries[0]?.latestSession).toBeNull();
	expect(entries[0]?.status).toBe("not-connected");
});

it("is ended (not not-connected) when the token's only session has ended", () => {
	const token = makeToken();
	const session = makeSession({ status: "ended" });

	const entries = deriveLocalAgentEntries([token], [session], NOW);

	expect(entries[0]?.status).toBe("ended");
});

it("excludes a revoked token even if it has sessions", () => {
	const token = makeToken({ revokedAt: new Date("2026-07-02T00:00:00Z") });
	const session = makeSession();

	const entries = deriveLocalAgentEntries([token], [session], NOW);

	expect(entries).toHaveLength(0);
});

it("never picks a different token's session as this token's latest", () => {
	const tokenA = makeToken({ id: "token-a" });
	const tokenB = makeToken({ id: "token-b" });
	const sessionForB = makeSession({
		id: "session-b",
		tokenId: "token-b",
		createdAt: new Date("2026-07-03T00:00:00Z"),
	});

	const entries = deriveLocalAgentEntries([tokenA, tokenB], [sessionForB], NOW);

	const entryA = entries.find((entry) => entry.token.id === "token-a");
	const entryB = entries.find((entry) => entry.token.id === "token-b");
	expect(entryA?.latestSession).toBeNull();
	expect(entryA?.status).toBe("not-connected");
	expect(entryB?.latestSession?.id).toBe("session-b");
});

it("is live when the latest session was seen within the live threshold", () => {
	const token = makeToken();
	const session = makeSession({
		status: "active",
		lastSeenAt: new Date(NOW.getTime() - (LOCAL_AGENT_LIVE_THRESHOLD_MS - 1)),
	});

	const entries = deriveLocalAgentEntries([token], [session], NOW);

	expect(entries[0]?.status).toBe("live");
});
