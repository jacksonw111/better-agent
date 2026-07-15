// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type FsChannel, registerFsChannel } from "./fs-channel-store";
import type { FsEntry } from "./fs-events";
import { LocalAgentFilesPane } from "./local-agent-files-pane";

// P4-T3: the Files tab pane — empty/upgrade hints, lazy tree loading over the
// registered fs channel, and the preview's content/binary/truncated states.

const CONNECT_HINT_RE = /连接会话/;
const UPGRADE_HINT_RE = /CLI 版本过旧/;
const SRC_RE = /src/;
const README_RE = /readme\.md/;
const APP_TS_RE = /app\.ts/;
const BINARY_RE = /二进制文件/;
const TOO_LARGE_RE = /超过 256KB/;
const READ_ERROR_RE = /无法读取文件：boom/;

const ROOT_ENTRIES: FsEntry[] = [
	{ name: "src", type: "dir" },
	{ name: "readme.md", size: 12, type: "file" },
];
const SRC_ENTRIES: FsEntry[] = [{ name: "app.ts", size: 8, type: "file" }];

let unregister: (() => void) | null = null;

afterEach(() => {
	unregister?.();
	unregister = null;
	cleanup();
});

function publish(overrides: Partial<FsChannel> = {}): FsChannel {
	const channel: FsChannel = {
		enabled: true,
		list: vi.fn((path?: string) =>
			Promise.resolve({
				entries: path === "src" ? SRC_ENTRIES : ROOT_ENTRIES,
				truncated: false,
			})
		),
		read: vi.fn(() =>
			Promise.resolve({ binary: false, content: "hello", truncated: false })
		),
		...overrides,
	};
	unregister = registerFsChannel(channel);
	return channel;
}

it("shows the connect hint without a channel, the upgrade hint when disabled", () => {
	const first = render(<LocalAgentFilesPane hidden={false} />);
	expect(within(first.container).getByText(CONNECT_HINT_RE)).toBeDefined();
	first.unmount();

	publish({ enabled: false });
	const second = render(<LocalAgentFilesPane hidden={false} />);
	expect(within(second.container).getByText(UPGRADE_HINT_RE)).toBeDefined();
});

it("loads the root when visible and lazily lists a dir on expand", async () => {
	const channel = publish();
	const { container } = render(<LocalAgentFilesPane hidden={false} />);
	const view = within(container);
	await waitFor(() => {
		expect(view.getByText("readme.md")).toBeDefined();
	});
	expect(channel.list).toHaveBeenCalledWith(undefined);
	expect(channel.list).toHaveBeenCalledTimes(1);

	fireEvent.click(view.getByRole("button", { name: SRC_RE }));
	await waitFor(() => {
		expect(view.getByText("app.ts")).toBeDefined();
	});
	expect(channel.list).toHaveBeenCalledWith("src");
});

it("opens a clicked file in the preview with its content and copy button", async () => {
	const channel = publish();
	const { container } = render(<LocalAgentFilesPane hidden={false} />);
	const view = within(container);
	await waitFor(() => {
		expect(view.getByText("readme.md")).toBeDefined();
	});

	fireEvent.click(view.getByRole("button", { name: README_RE }));
	await waitFor(() => {
		expect(view.getByText("hello")).toBeDefined();
	});
	expect(channel.read).toHaveBeenCalledWith("readme.md");
	expect(
		view.getByRole("button", { name: "Copy file contents" })
	).toBeDefined();
});

it("renders the binary and too-large states instead of content", async () => {
	publish({
		read: vi.fn((path: string) =>
			Promise.resolve(
				path === "readme.md"
					? { binary: true, content: "", truncated: false }
					: { binary: false, content: "head only", truncated: true }
			)
		),
	});
	const { container } = render(<LocalAgentFilesPane hidden={false} />);
	const view = within(container);
	await waitFor(() => {
		expect(view.getByText("readme.md")).toBeDefined();
	});

	fireEvent.click(view.getByRole("button", { name: README_RE }));
	await waitFor(() => {
		expect(view.getByText(BINARY_RE)).toBeDefined();
	});
	expect(view.queryByRole("button", { name: "Copy file contents" })).toBeNull();

	fireEvent.click(view.getByRole("button", { name: SRC_RE }));
	await waitFor(() => {
		expect(view.getByText("app.ts")).toBeDefined();
	});
	fireEvent.click(view.getByRole("button", { name: APP_TS_RE }));
	await waitFor(() => {
		expect(view.getByText("head only")).toBeDefined();
	});
	expect(view.getByText(TOO_LARGE_RE)).toBeDefined();
});

it("surfaces a read failure as the preview error state", async () => {
	publish({
		read: vi.fn(() => Promise.reject(new Error("boom"))),
	});
	const { container } = render(<LocalAgentFilesPane hidden={false} />);
	const view = within(container);
	await waitFor(() => {
		expect(view.getByText("readme.md")).toBeDefined();
	});

	fireEvent.click(view.getByRole("button", { name: README_RE }));
	await waitFor(() => {
		expect(view.getByText(READ_ERROR_RE)).toBeDefined();
	});
});
