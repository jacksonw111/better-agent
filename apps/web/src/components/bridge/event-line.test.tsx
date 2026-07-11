// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { StatusLine } from "./event-line";

function renderStatus(status: string) {
	const { container } = render(
		<StatusLine event={{ kind: "status", status }} />
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
