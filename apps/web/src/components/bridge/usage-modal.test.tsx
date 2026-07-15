// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
	TurnUsageDetail,
	UsageUpdateDetail,
} from "./bridge-session-status";
import type { StatusSnapshotDetail } from "./bridge-status-snapshot";
import { UsageModal } from "./usage-modal";
import { TerminalUsageStrip } from "./usage-strip";

// P3-T4: the usage modal — pure assembly of the already-parsed turn_usage /
// usage_update / status_snapshot details into one Dialog, opened from the
// inline usage strip above the composer. Dialog content renders through a
// portal onto document.body, so assertions query via `screen`.

const TURN_USAGE: TurnUsageDetail = {
	costUsd: 0.0123,
	durationMs: 4500,
	numTurns: 3,
	usage: { cacheReadInputTokens: 8000, inputTokens: 1200, outputTokens: 567 },
};

const USAGE_UPDATE: UsageUpdateDetail = { size: 200_000, used: 48_213 };

const SNAPSHOT: StatusSnapshotDetail = {
	costUsd: 0.5,
	mcpServers: [{ name: "playwright", status: "connected" }],
	model: "claude-opus-4",
	permissionMode: "default",
	quota: {
		fetchedAt: new Date().toISOString(),
		provider: "claude",
		windows: [{ label: "5h window", usedPercent: 38 }],
	},
	tokens: { input: 1000, output: 500 },
};

const noopOpenChange = () => {
	// the modal stays open for the duration of each assertion
};

afterEach(() => {
	cleanup();
});

it("renders 本回合/上下文/会话统计/账号配额/MCP sections from full fixtures", () => {
	render(
		<UsageModal
			getStatus={vi.fn().mockResolvedValue(undefined)}
			onOpenChange={noopOpenChange}
			open={true}
			statusSnapshot={SNAPSHOT}
			turnUsage={TURN_USAGE}
			usageUpdate={USAGE_UPDATE}
		/>
	);

	expect(screen.getByText("本回合")).toBeDefined();
	expect(screen.getByText("$0.0123")).toBeDefined();
	expect(screen.getByText("1.2k")).toBeDefined();
	expect(screen.getByText("4.5s")).toBeDefined();
	expect(screen.getByText("上下文")).toBeDefined();
	expect(screen.getByText("48k/200k tok · 24%")).toBeDefined();
	expect(screen.getByText("会话统计")).toBeDefined();
	expect(screen.getByText("claude-opus-4")).toBeDefined();
	expect(screen.getByText("default")).toBeDefined();
	expect(screen.getByText("$0.5000")).toBeDefined();
	expect(screen.getByText("账号配额")).toBeDefined();
	expect(screen.getByText("剩余 62%")).toBeDefined();
	expect(screen.getByText("MCP")).toBeDefined();
	expect(screen.getByText("playwright")).toBeDefined();
});

it("omits every section whose data never arrived — a turn_usage-only modal", () => {
	render(
		<UsageModal
			getStatus={vi.fn().mockResolvedValue(undefined)}
			onOpenChange={noopOpenChange}
			open={true}
			statusSnapshot={null}
			turnUsage={TURN_USAGE}
			usageUpdate={null}
		/>
	);

	expect(screen.getByText("本回合")).toBeDefined();
	expect(screen.queryByText("上下文")).toBeNull();
	expect(screen.queryByText("会话统计")).toBeNull();
	expect(screen.queryByText("账号配额")).toBeNull();
	expect(screen.queryByText("MCP")).toBeNull();
});

it("falls back to the snapshot's contextUsage when no usage_update has streamed", () => {
	render(
		<UsageModal
			getStatus={vi.fn().mockResolvedValue(undefined)}
			onOpenChange={noopOpenChange}
			open={true}
			statusSnapshot={{
				contextUsage: { pct: 24, size: 200_000, used: 48_213 },
			}}
			turnUsage={null}
			usageUpdate={null}
		/>
	);

	expect(screen.getByText("上下文")).toBeDefined();
	expect(screen.getByText("48k/200k tok · 24%")).toBeDefined();
});

it("shows a muted 暂无数据 line when nothing has arrived at all", () => {
	render(
		<UsageModal
			getStatus={vi.fn().mockResolvedValue(undefined)}
			onOpenChange={noopOpenChange}
			open={true}
			statusSnapshot={null}
			turnUsage={null}
			usageUpdate={null}
		/>
	);

	expect(screen.getByText("暂无数据 — 等待会话上报用量。")).toBeDefined();
	expect(screen.queryByText("本回合")).toBeNull();
});

it("requests a fresh status_snapshot once each time the modal opens", () => {
	const getStatus = vi.fn().mockResolvedValue(undefined);
	const { rerender } = render(
		<UsageModal
			getStatus={getStatus}
			onOpenChange={noopOpenChange}
			open={false}
			statusSnapshot={null}
			turnUsage={TURN_USAGE}
			usageUpdate={null}
		/>
	);
	expect(getStatus).not.toHaveBeenCalled();

	rerender(
		<UsageModal
			getStatus={getStatus}
			onOpenChange={noopOpenChange}
			open={true}
			statusSnapshot={null}
			turnUsage={TURN_USAGE}
			usageUpdate={null}
		/>
	);

	expect(getStatus).toHaveBeenCalledTimes(1);
});

it("opens the modal from the usage strip's button and fires getStatus", () => {
	const getStatus = vi.fn().mockResolvedValue(undefined);
	render(
		<TerminalUsageStrip
			getStatus={getStatus}
			statusSnapshot={null}
			turnUsage={TURN_USAGE}
			usageUpdate={null}
		/>
	);
	expect(screen.queryByText("用量")).toBeNull();

	fireEvent.click(screen.getByRole("button", { name: "查看用量详情" }));

	expect(screen.getByText("用量")).toBeDefined();
	expect(screen.getByText("本回合")).toBeDefined();
	expect(getStatus).toHaveBeenCalledTimes(1);
});

it("renders no strip trigger before any usage detail has arrived", () => {
	render(
		<TerminalUsageStrip
			getStatus={vi.fn().mockResolvedValue(undefined)}
			statusSnapshot={null}
			turnUsage={null}
			usageUpdate={null}
		/>
	);

	expect(screen.queryByRole("button", { name: "查看用量详情" })).toBeNull();
});
