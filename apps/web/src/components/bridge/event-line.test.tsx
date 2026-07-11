// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ApprovalEvent } from "./bridge-events";
import { ApprovalLine, StatusLine } from "./event-line";

function renderStatus(status: string) {
	const { container } = render(
		<StatusLine event={{ kind: "status", status }} />
	);
	return within(container);
}

const BASE_APPROVAL_EVENT: ApprovalEvent = {
	kind: "approval",
	options: [{ id: "accept", label: "Allow" }],
	requestId: "req_1",
	title: "Run command?",
};

function renderApproval(event: ApprovalEvent) {
	const { container } = render(<ApprovalLine event={event} />);
	return { ...within(container), container };
}

// R3-T2: arbitrary offsets from "now" for a not-yet-expired vs. an
// already-expired timeoutAt — a minute ahead, a second behind.
const FUTURE_TIMEOUT_OFFSET_MS = 60_000;
const PAST_TIMEOUT_OFFSET_MS = 1000;

const SUMMARY_TEXT_PATTERN = /\d+ files?:/;

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

// R3-T2: codex fileChange approval requests carry a change-summary line.
it("renders event.summary as a muted line under the title when present", () => {
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		summary: "2 files: 1 added, 1 modified (a.ts, b.ts)",
	});
	const summary = view.getByText("2 files: 1 added, 1 modified (a.ts, b.ts)");
	expect(summary.dataset.slot).toBe("approval-summary");
});

it("renders no summary line when event.summary is absent", () => {
	const view = renderApproval(BASE_APPROVAL_EVENT);
	expect(view.queryByText(SUMMARY_TEXT_PATTERN, { exact: false })).toBeNull();
});

// R3-T2: presentApproval (apps/bridge-cli/src/adapters/approvals.ts) stamps
// timeoutAt; the card shows a shrinking countdown bar until then.
it("renders a countdown bar when timeoutAt is in the future", () => {
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		timeoutAt: Date.now() + FUTURE_TIMEOUT_OFFSET_MS,
	});
	const bar = view.container.querySelector('[data-slot="approval-countdown"]');
	expect(bar).not.toBeNull();
});

it("renders no countdown bar when timeoutAt is absent", () => {
	const view = renderApproval(BASE_APPROVAL_EVENT);
	expect(
		view.container.querySelector('[data-slot="approval-countdown"]')
	).toBeNull();
});

it("shows the expiry notice instead of the bar once timeoutAt has passed", () => {
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		timeoutAt: Date.now() - PAST_TIMEOUT_OFFSET_MS,
	});
	expect(view.getByText("已超时，按拒绝处理")).toBeDefined();
	expect(
		view.container.querySelector('[data-slot="approval-countdown"]')
	).toBeNull();
});

it("hides the countdown once the card is answered", () => {
	const { container } = render(
		<ApprovalLine
			answeredOptionId="accept"
			event={{
				...BASE_APPROVAL_EVENT,
				timeoutAt: Date.now() + FUTURE_TIMEOUT_OFFSET_MS,
			}}
		/>
	);
	expect(
		container.querySelector('[data-slot="approval-countdown"]')
	).toBeNull();
});

// R3-T2: codex offers a third "acceptForSession" option — the button layout
// must render every option event.options carries, not just the first two.
it("renders one button per option, including a third option", () => {
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		options: [
			{ id: "accept", label: "Allow" },
			{ id: "acceptForSession", label: "Allow for session" },
			{ id: "decline", label: "Deny" },
		],
	});
	expect(view.getByRole("button", { name: "Allow" })).toBeDefined();
	expect(view.getByRole("button", { name: "Allow for session" })).toBeDefined();
	expect(view.getByRole("button", { name: "Deny" })).toBeDefined();
});
