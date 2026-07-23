// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { StatusLine } from "./status-line";

function renderStatus(status: string, detail?: unknown) {
	const { container } = render(
		<StatusLine event={{ detail, kind: "status", status }} />
	);
	return within(container);
}

it("maps a curated wire status to human-readable Chinese copy, not the raw token", () => {
	const view = renderStatus("stalled");
	expect(view.getByText("agent 无响应，已自动中断")).toBeDefined();
	expect(view.queryByText("stalled")).toBeNull();
});

it("maps restarting/stopped_by_server/agent_exited/session_resumed too", () => {
	expect(renderStatus("restarting").getByText("正在重启 agent…")).toBeDefined();
	expect(
		renderStatus("stopped_by_server").getByText("会话已由服务端结束")
	).toBeDefined();
	expect(
		renderStatus("agent_exited").getByText("agent 进程已退出")
	).toBeDefined();
	expect(renderStatus("session_resumed").getByText("会话已恢复")).toBeDefined();
});

// R3-T1 Part B: pi's extension_ui_request input/editor auto-cancel gets a
// visible Chinese notice instead of vanishing silently.
it("maps extension_ui_auto_cancelled to the local-input-unsupported notice", () => {
	const view = renderStatus("extension_ui_auto_cancelled");
	expect(
		view.getByText("agent 请求了本地输入（远程暂不支持），已自动取消")
	).toBeDefined();
});

// R5-T1: codex's restart-chain thread/resume failure notice — see
// apps/bridge-cli/src/adapters/codex-resume.ts's doc comment.
it("maps resume_failed to the lost-context notice, warn-toned", () => {
	const view = renderStatus("resume_failed");
	const text = view.getByText("无法恢复上下文，已开启新会话");
	expect(text).toBeDefined();
	expect(text.closest("p")?.className).toContain("amber");
});

// fix-truncation-reason: the CLI reuses `event_truncated` for two unrelated
// causes. A size-truncated event's detail has no `reason` (see
// apps/bridge-cli/src/truncate-event.ts's degradeToTruncatedStatus) and keeps
// the "output too long" copy...
it("renders the size-truncation copy for event_truncated with no reason", () => {
	const view = renderStatus("event_truncated", { originalKind: "message" });
	expect(view.getByText("输出过长，已截断")).toBeDefined();
});

// ...while a backlog-overflow drop carries reason: "push_backlog_overflow"
// (see apps/bridge-cli/src/forward-events-shed.ts's droppedDeltaMarker) — a
// network-congestion story, NOT a size one — and gets its own warn notice.
it("renders the network-congestion copy for a push_backlog_overflow drop", () => {
	const view = renderStatus("event_truncated", {
		droppedEvents: 3,
		originalKind: "output",
		reason: "push_backlog_overflow",
	});
	const text = view.getByText("网络拥塞，部分输出未送达");
	expect(text).toBeDefined();
	expect(text.closest("p")?.className).toContain("amber");
	expect(view.queryByText("输出过长，已截断")).toBeNull();
});

it("falls back to a cleaned (underscore-free) label for an unmapped status", () => {
	const view = renderStatus("some_future_status");
	expect(view.getByText("some future status")).toBeDefined();
});

it("colors a warn-tier status amber and an error-tier status destructive", () => {
	const warn = renderStatus("restarting").getByText("正在重启 agent…");
	expect(warn.closest("p")?.className).toContain("amber");

	const error = renderStatus("stalled").getByText("agent 无响应，已自动中断");
	expect(error.closest("p")?.className).toContain("text-destructive");
});
