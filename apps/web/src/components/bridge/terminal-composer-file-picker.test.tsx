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
import { TerminalComposer } from "./terminal-composer";

// P4-T3: the composer's @file picker — opens on a trailing "@" when the fs
// channel is enabled, inserts `@path ` on file selection, descends on dir
// selection, and never opens without an (enabled) channel.

const README_RE = /readme\.md/;
const SRC_RE = /src/;
const APP_TS_RE = /app\.ts/;

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

function publish(enabled = true): FsChannel {
	const channel: FsChannel = {
		enabled,
		list: vi.fn((path?: string) =>
			Promise.resolve({
				entries: path === "src" ? SRC_ENTRIES : ROOT_ENTRIES,
				truncated: false,
			})
		),
		read: vi.fn(() =>
			Promise.resolve({ binary: false, content: "", truncated: false })
		),
	};
	unregister = registerFsChannel(channel);
	return channel;
}

function renderComposer() {
	const { container } = render(
		<TerminalComposer disabled={false} onSend={vi.fn()} sending={false} />
	);
	const view = within(container);
	return {
		textarea: view.getByLabelText("Message") as HTMLTextAreaElement,
		view,
	};
}

it("opens on a trailing @ and inserts `@path ` when a file is picked", async () => {
	publish();
	const { textarea, view } = renderComposer();

	fireEvent.change(textarea, { target: { value: "@" } });
	await waitFor(() => {
		expect(view.getByRole("option", { name: README_RE })).toBeDefined();
	});

	fireEvent.mouseDown(view.getByRole("option", { name: README_RE }));
	expect(textarea.value).toBe("@readme.md ");
	// The trailing space closed the mention — the picker is gone.
	expect(view.queryByRole("listbox")).toBeNull();
});

it("descends into a picked directory and lists it", async () => {
	const channel = publish();
	const { textarea, view } = renderComposer();

	fireEvent.change(textarea, { target: { value: "check @s" } });
	await waitFor(() => {
		expect(view.getByRole("option", { name: SRC_RE })).toBeDefined();
	});

	fireEvent.mouseDown(view.getByRole("option", { name: SRC_RE }));
	expect(textarea.value).toBe("check @src/");
	await waitFor(() => {
		expect(view.getByRole("option", { name: APP_TS_RE })).toBeDefined();
	});
	expect(channel.list).toHaveBeenCalledWith("src");
});

it("stays closed without an enabled fs channel", async () => {
	publish(false);
	const { textarea, view } = renderComposer();

	fireEvent.change(textarea, { target: { value: "@" } });
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(view.queryByRole("listbox")).toBeNull();
});

it("Escape dismisses the picker without clearing the composer", async () => {
	publish();
	const { textarea, view } = renderComposer();

	fireEvent.change(textarea, { target: { value: "@read" } });
	await waitFor(() => {
		expect(view.getByRole("option", { name: README_RE })).toBeDefined();
	});

	fireEvent.keyDown(textarea, { key: "Escape" });
	expect(view.queryByRole("listbox")).toBeNull();
	expect(textarea.value).toBe("@read");
});
