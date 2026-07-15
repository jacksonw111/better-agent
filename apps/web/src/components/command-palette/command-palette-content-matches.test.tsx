// @vitest-environment jsdom
// P4-T5: the sessions page's "内容匹配" group — debounce (one search per
// settled query), result rendering (title + snippet), the copy-resume-command
// select action, the partial hint, and the no-channel/short-query gates.

import { Command } from "@better-agent/ui/components/command";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerSessionSearchChannel } from "../bridge/session-search-store";
import { SessionContentMatches } from "./command-palette-content-matches";
import type { WorkspaceCommandTarget } from "./command-palette-store";

vi.mock("@/utils/orpc", async () => {
	const mocks = await import("../bridge/local-agent-workspace-test-mocks");
	return mocks.buildOrpcMock();
});

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

const SEARCHING_PATTERN = /正在搜索会话内容/;
const PARTIAL_PATTERN = /结果可能不完整/;

const workspace: WorkspaceCommandTarget = {
	openSettings: () => undefined,
	setTab: () => undefined,
	tab: "chat",
	tokenId: "token-1",
};

const HIT = {
	cwd: "/tmp/project",
	id: "agent-session-1",
	snippets: [{ role: "user" as const, text: "fix the login bug" }],
	title: "login work",
};

const channelCleanups: (() => void)[] = [];

function publishChannel(search: (query: string) => Promise<unknown>) {
	channelCleanups.push(
		registerSessionSearchChannel({
			enabled: true,
			search: search as (
				query: string
			) => Promise<{ hits: (typeof HIT)[]; partial: boolean }>,
		})
	);
}

function renderMatches(query: string) {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<Command shouldFilter={false}>
				<SessionContentMatches
					onRun={(action) => action()}
					query={query}
					workspace={workspace}
				/>
			</Command>
		</QueryClientProvider>
	);
}

beforeEach(async () => {
	vi.useFakeTimers();
	const { resetWorkspaceStore, workspaceStore, makeToken } = await import(
		"../bridge/local-agent-workspace-test-utils"
	);
	resetWorkspaceStore();
	workspaceStore.tokens = [makeToken({ agentKind: "codex" })];
});

afterEach(() => {
	cleanup();
	for (const dispose of channelCleanups.splice(0)) {
		dispose();
	}
	vi.useRealTimers();
	vi.clearAllMocks();
});

it("renders nothing without a published channel or below two characters", async () => {
	renderMatches("needle");
	expect(screen.queryByText("内容匹配")).toBeNull();
	cleanup(); // unmount before the channel arrives — it would re-render this one

	const search = vi.fn().mockResolvedValue({ hits: [], partial: false });
	publishChannel(search);
	renderMatches("n");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(500);
	});
	expect(screen.queryByText("内容匹配")).toBeNull();
	expect(search).not.toHaveBeenCalled();
});

it("debounces: a re-typed query fires ONE search after 300ms of quiet", async () => {
	const search = vi.fn().mockResolvedValue({ hits: [], partial: false });
	publishChannel(search);
	const view = renderMatches("nee");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(200);
	});
	expect(search).not.toHaveBeenCalled();

	view.rerender(
		<QueryClientProvider client={new QueryClient()}>
			<Command shouldFilter={false}>
				<SessionContentMatches
					onRun={(action) => action()}
					query="needle"
					workspace={workspace}
				/>
			</Command>
		</QueryClientProvider>
	);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(299);
	});
	expect(search).not.toHaveBeenCalled();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
	expect(search).toHaveBeenCalledTimes(1);
	expect(search).toHaveBeenCalledWith("needle");
});

it("shows the loading row, then the hit's title + snippet and a partial hint", async () => {
	publishChannel(vi.fn().mockResolvedValue({ hits: [HIT], partial: true }));
	renderMatches("login");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(100);
	});
	expect(screen.getByText(SEARCHING_PATTERN)).toBeDefined();

	await act(async () => {
		await vi.advanceTimersByTimeAsync(300);
	});
	expect(screen.getByText("login work")).toBeDefined();
	expect(screen.getByText("fix the login bug")).toBeDefined();
	expect(screen.getByText(PARTIAL_PATTERN)).toBeDefined();
});

it("selecting a match copies the agent-kind-correct resume command and toasts", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.assign(navigator, { clipboard: { writeText } });
	publishChannel(vi.fn().mockResolvedValue({ hits: [HIT], partial: false }));
	renderMatches("login");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(300);
	});

	fireEvent.click(screen.getByText("login work"));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});

	expect(writeText).toHaveBeenCalledTimes(1);
	const copied = writeText.mock.calls[0]?.[0] as string;
	expect(copied).toContain("--agent codex");
	expect(copied).toContain("--dir /tmp/project");
	expect(copied).toContain("--resume agent-session-1");
	const { toast } = await import("sonner");
	expect(toast.success).toHaveBeenCalledWith("已复制恢复命令");
});
