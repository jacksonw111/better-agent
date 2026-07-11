import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import {
	latestStatusSnapshotDetail,
	parseStatusSnapshotDetail,
} from "./bridge-status-snapshot";

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

it("returns null when no status_snapshot event has arrived", () => {
	expect(latestStatusSnapshotDetail([])).toBeNull();
});

it("parses a well-formed status_snapshot detail", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "status_snapshot",
			detail: {
				model: "claude-opus-4-6",
				permissionMode: "acceptEdits",
				running: true,
				costUsd: 0.42,
				contextUsage: { used: 48_000, size: 200_000, pct: 24 },
				tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
				mcpServers: [{ name: "docs", status: "connected" }],
			},
		}),
	];
	expect(latestStatusSnapshotDetail(events)).toEqual({
		model: "claude-opus-4-6",
		permissionMode: "acceptEdits",
		running: true,
		costUsd: 0.42,
		contextUsage: { used: 48_000, size: 200_000, pct: 24 },
		tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
		mcpServers: [{ name: "docs", status: "connected" }],
	});
});

it("picks the latest status_snapshot, ignoring an earlier one", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "status_snapshot",
			detail: { model: "old-model" },
		}),
		ev(2, {
			kind: "status",
			status: "status_snapshot",
			detail: { model: "new-model" },
		}),
	];
	expect(latestStatusSnapshotDetail(events)?.model).toBe("new-model");
});

it("returns null (not a thrown error) for a malformed detail", () => {
	expect(parseStatusSnapshotDetail("not-an-object")).toBeNull();
	expect(parseStatusSnapshotDetail(null)).toBeNull();
	expect(parseStatusSnapshotDetail(42)).toBeNull();
});

it("returns a safe-empty detail when every field is the wrong shape", () => {
	expect(
		parseStatusSnapshotDetail({
			model: 5,
			permissionMode: null,
			running: "yes",
			costUsd: "free",
			contextUsage: "nope",
			tokens: 5,
			mcpServers: "x",
		})
	).toEqual({
		model: undefined,
		permissionMode: undefined,
		running: undefined,
		costUsd: undefined,
		contextUsage: undefined,
		tokens: undefined,
		mcpServers: undefined,
	});
});

it("parses a partial detail, leaving unreported fields undefined", () => {
	expect(
		parseStatusSnapshotDetail({ model: "codex-mini", running: false })
	).toEqual({
		model: "codex-mini",
		permissionMode: undefined,
		running: false,
		costUsd: undefined,
		contextUsage: undefined,
		tokens: undefined,
		mcpServers: undefined,
	});
});

// R4-T1: the account-quota half of a status_snapshot.
it("parses a well-formed quota snapshot with its windows", () => {
	const detail = parseStatusSnapshotDetail({
		model: "codex-mini",
		quota: {
			provider: "codex",
			fetchedAt: "2026-07-11T12:00:00Z",
			windows: [
				{
					label: "5小时窗口",
					usedPercent: 42,
					resetsAt: "2026-07-11T18:00:00Z",
				},
				{ label: "Credits", usedPercent: 0, detail: "Balance: 12.5" },
			],
		},
	});
	expect(detail?.quota).toEqual({
		provider: "codex",
		fetchedAt: "2026-07-11T12:00:00Z",
		plan: undefined,
		unavailableReason: undefined,
		windows: [
			{
				label: "5小时窗口",
				usedPercent: 42,
				resetsAt: "2026-07-11T18:00:00Z",
				detail: undefined,
			},
			{
				label: "Credits",
				usedPercent: 0,
				resetsAt: undefined,
				detail: "Balance: 12.5",
			},
		],
	});
});

it("parses a fail-open quota snapshot (empty windows + unavailableReason)", () => {
	const detail = parseStatusSnapshotDetail({
		quota: {
			provider: "claude",
			fetchedAt: "2026-07-11T12:00:00Z",
			windows: [],
			unavailableReason: "credentials not accessible",
		},
	});
	expect(detail?.quota).toEqual({
		provider: "claude",
		fetchedAt: "2026-07-11T12:00:00Z",
		plan: undefined,
		windows: [],
		unavailableReason: "credentials not accessible",
	});
});

it("drops a malformed quota value instead of throwing", () => {
	expect(parseStatusSnapshotDetail({ quota: "nope" })?.quota).toBeUndefined();
	expect(
		parseStatusSnapshotDetail({ quota: { provider: "codex" } })?.quota
	).toBeUndefined();
	expect(
		parseStatusSnapshotDetail({
			quota: { provider: "codex", fetchedAt: "t", windows: [{ label: "x" }] },
		})?.quota?.windows
	).toEqual([]);
});
