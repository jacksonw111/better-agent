import { expect, it } from "vitest";
import type { BridgeSessionRow } from "@/utils/api-types";
import {
	deriveSessionSignal,
	mergeSessionPages,
	pickActiveSession,
} from "./local-agent-workspace-sessions";

const ONE_SECOND_MS = 1000;
const TWO_MINUTES_MS = 120_000;
const NOW = new Date("2026-07-14T12:00:00Z");
const RECENT = new Date(NOW.getTime() - ONE_SECOND_MS);
const STALE = new Date(NOW.getTime() - TWO_MINUTES_MS);

function makeSession(overrides: Partial<BridgeSessionRow>): BridgeSessionRow {
	return {
		agentKind: "claude-code",
		agentSessionId: null,
		attention: null,
		createdAt: NOW,
		id: "session-x",
		label: "session-x",
		lastSeenAt: RECENT,
		status: "active",
		tokenId: "token-1",
		userId: "user-1",
		vncEndpoint: null,
		...overrides,
	} as BridgeSessionRow;
}

it("mergeSessionPages keeps first-page rows and appends unseen older rows", () => {
	const first = [makeSession({ id: "a" }), makeSession({ id: "b" })];
	const older = [makeSession({ id: "b" }), makeSession({ id: "c" })];
	expect(mergeSessionPages(first, older).map((s) => s.id)).toEqual([
		"a",
		"b",
		"c",
	]);
});

it("mergeSessionPages lets the fresh first-page copy win over a stale duplicate", () => {
	const first = [makeSession({ id: "a", attention: "approval" })];
	const older = [makeSession({ id: "a", attention: null })];
	expect(mergeSessionPages(first, older)[0].attention).toBe("approval");
});

it("pickActiveSession honors a known ?session= id", () => {
	const sessions = [makeSession({ id: "new" }), makeSession({ id: "old" })];
	expect(pickActiveSession(sessions, "old")?.id).toBe("old");
});

it("pickActiveSession follows the newest when the id is unknown or absent", () => {
	const sessions = [makeSession({ id: "new" }), makeSession({ id: "old" })];
	expect(pickActiveSession(sessions, "gone")?.id).toBe("new");
	expect(pickActiveSession(sessions, undefined)?.id).toBe("new");
	expect(pickActiveSession([], "any")).toBeNull();
});

it("deriveSessionSignal ranks approval over processing over liveness", () => {
	expect(deriveSessionSignal(makeSession({ attention: "approval" }), NOW)).toBe(
		"approval"
	);
	expect(
		deriveSessionSignal(makeSession({ attention: "processing" }), NOW)
	).toBe("processing");
	expect(deriveSessionSignal(makeSession({}), NOW)).toBe("live");
	expect(deriveSessionSignal(makeSession({ lastSeenAt: STALE }), NOW)).toBe(
		"idle"
	);
});

it("deriveSessionSignal never shows attention on an ended session", () => {
	const ended = makeSession({ attention: "approval", status: "ended" });
	expect(deriveSessionSignal(ended, NOW)).toBe("ended");
});
