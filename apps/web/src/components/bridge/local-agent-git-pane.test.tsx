// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type GitChannel, registerGitChannel } from "./git-channel-store";
import type { GitStatusResult } from "./git-events";
import { LocalAgentGitPane } from "./local-agent-git-pane";

// P4-T4: the Git tab pane — empty/upgrade hints, the grouped status list over
// the registered git channel, click→diff, and the commit-all flow (toast +
// status refresh). Mirrors local-agent-files-pane.test.tsx.

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

const CONNECT_HINT_RE = /连接会话/;
const UPGRADE_HINT_RE = /CLI 版本过旧/;
const NOT_A_REPO_RE = /不是 Git 仓库/;
const CLEAN_TREE_RE = /工作区干净/;
const STAGED_GROUP_RE = /已暂存（1）/;
const UNSTAGED_GROUP_RE = /未暂存（1）/;
const UNTRACKED_GROUP_RE = /未跟踪（1）/;
const DIFF_LINE_RE = /\+new line/;
const APP_ROW_RE = /app\.ts/;
const COMMIT_BUTTON_RE = /提交全部变更/;

const SUMMARY: GitStatusResult = {
	ahead: 1,
	branch: "main",
	entries: [
		{ path: "app.ts", x: "M", y: " " },
		{ path: "lib.ts", x: " ", y: "M" },
		{ path: "new.ts", x: "?", y: "?" },
	],
	notARepo: false,
	truncated: false,
};

let unregister: (() => void) | null = null;

afterEach(() => {
	unregister?.();
	unregister = null;
	cleanup();
});

function publish(overrides: Partial<GitChannel> = {}): GitChannel {
	const channel: GitChannel = {
		commit: vi.fn(() => Promise.resolve({ hash: "abc1234" })),
		diff: vi.fn(() =>
			Promise.resolve({ content: "+new line\n-old line\n", truncated: false })
		),
		enabled: true,
		status: vi.fn(() => Promise.resolve(SUMMARY)),
		...overrides,
	};
	unregister = registerGitChannel(channel);
	return channel;
}

it("shows the connect hint without a channel, the upgrade hint when disabled", () => {
	const first = render(<LocalAgentGitPane hidden={false} />);
	expect(within(first.container).getByText(CONNECT_HINT_RE)).toBeDefined();
	first.unmount();

	publish({ enabled: false });
	const second = render(<LocalAgentGitPane hidden={false} />);
	expect(within(second.container).getByText(UPGRADE_HINT_RE)).toBeDefined();
});

it("loads the status when visible and renders branch + grouped entries", async () => {
	const channel = publish();
	const { container } = render(<LocalAgentGitPane hidden={false} />);
	const view = within(container);
	await waitFor(() => {
		expect(view.getByText("main")).toBeDefined();
	});
	expect(channel.status).toHaveBeenCalledTimes(1);
	expect(view.getByText(STAGED_GROUP_RE)).toBeDefined();
	expect(view.getByText(UNSTAGED_GROUP_RE)).toBeDefined();
	expect(view.getByText(UNTRACKED_GROUP_RE)).toBeDefined();
	expect(view.getByText("↑1")).toBeDefined();
});

it("renders the not-a-repo and clean-tree states", async () => {
	publish({
		status: vi.fn(() =>
			Promise.resolve({ ...SUMMARY, entries: [], notARepo: true })
		),
	});
	const first = render(
		<LocalAgentGitPane
			hidden={false}
			workspacePath="/home/u/.better-agent/tasks/task-1"
		/>
	);
	const firstView = within(first.container);
	await waitFor(() => {
		expect(firstView.getByText(NOT_A_REPO_RE)).toBeDefined();
	});
	// The explanation names the workspace, the header drops the "…" branch,
	// and the never-applicable commit box is gone rather than disabled.
	expect(
		firstView.getByText("/home/u/.better-agent/tasks/task-1")
	).toBeDefined();
	expect(firstView.getByText("非 Git 仓库")).toBeDefined();
	expect(firstView.queryByLabelText("Commit message")).toBeNull();
	first.unmount();
	unregister?.();

	publish({
		status: vi.fn(() => Promise.resolve({ ...SUMMARY, entries: [] })),
	});
	const second = render(<LocalAgentGitPane hidden={false} />);
	await waitFor(() => {
		expect(within(second.container).getByText(CLEAN_TREE_RE)).toBeDefined();
	});
});

it("opens a clicked file's diff with tinted lines", async () => {
	const channel = publish();
	const { container } = render(<LocalAgentGitPane hidden={false} />);
	const view = within(container);
	await waitFor(() => {
		expect(view.getByText(APP_ROW_RE)).toBeDefined();
	});

	fireEvent.click(view.getByRole("button", { name: APP_ROW_RE }));
	await waitFor(() => {
		expect(view.getByText(DIFF_LINE_RE)).toBeDefined();
	});
	expect(channel.diff).toHaveBeenCalledWith("app.ts");
});

it("commits all changes and refreshes the status list", async () => {
	const channel = publish();
	const { container } = render(<LocalAgentGitPane hidden={false} />);
	const view = within(container);
	await waitFor(() => {
		expect(view.getByText("main")).toBeDefined();
	});

	fireEvent.change(view.getByLabelText("Commit message"), {
		target: { value: "feat: commit from web" },
	});
	fireEvent.click(view.getByRole("button", { name: COMMIT_BUTTON_RE }));
	await waitFor(() => {
		expect(channel.commit).toHaveBeenCalledWith("feat: commit from web");
	});
	await waitFor(() => {
		expect(channel.status).toHaveBeenCalledTimes(2);
	});
});

it("disables the commit button while the message is empty", async () => {
	publish();
	const { container } = render(<LocalAgentGitPane hidden={false} />);
	const view = within(container);
	await waitFor(() => {
		expect(view.getByText("main")).toBeDefined();
	});
	const button = view.getByRole("button", { name: COMMIT_BUTTON_RE });
	expect(button.hasAttribute("disabled")).toBe(true);
});
