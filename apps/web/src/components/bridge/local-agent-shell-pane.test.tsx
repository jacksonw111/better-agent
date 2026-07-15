// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { LocalAgentShellPane } from "./local-agent-shell-pane";
import { registerShellChannel, type ShellChannel } from "./shell-channel-store";

// P4-T2: the Shell tab pane — runs commands over the registered shell channel
// and renders the feed's runShell results as command cards, with graceful
// empty states when no channel / capability is present.

const UPGRADE_HINT_RE = /CLI 版本过旧/;
const EMPTY_HINT_RE = /输入命令/;

const shellEvent = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

function publish(overrides: Partial<ShellChannel> = {}): () => void {
	return registerShellChannel({
		enabled: true,
		events: [],
		run: vi.fn(() => Promise.resolve()),
		...overrides,
	});
}

afterEach(() => {
	cleanup();
	// Clear the module store between tests (unregister via a fresh empty publish
	// then let its cleanup null it out).
	const unregister = publish();
	unregister();
});

it("runs a typed command through the channel and clears the input", () => {
	const run = vi.fn(() => Promise.resolve());
	publish({ run });
	const { container } = render(<LocalAgentShellPane hidden={false} />);
	const input =
		within(container).getByLabelText<HTMLInputElement>("Shell command");
	fireEvent.change(input, { target: { value: "ls -la" } });
	fireEvent.submit(input.closest("form") as HTMLFormElement);
	expect(run).toHaveBeenCalledWith("ls -la");
	expect(input.value).toBe("");
});

it("renders a runShell result as a command card", () => {
	publish({
		events: [
			shellEvent(1, {
				id: "s1",
				input: { command: "echo hi" },
				kind: "tool",
				name: "shell",
				source: "runShell",
				status: "started",
			}),
			shellEvent(2, {
				id: "s1",
				kind: "tool",
				name: "shell",
				output: "hi\n[shell: exit code 0]",
				source: "runShell",
				status: "completed",
			}),
		],
	});
	const { container } = render(<LocalAgentShellPane hidden={false} />);
	expect(within(container).getByText("echo hi")).toBeDefined();
});

it("shows an upgrade hint when the CLI lacks the shell capability", () => {
	publish({ enabled: false });
	const { container } = render(<LocalAgentShellPane hidden={false} />);
	expect(within(container).getByText(UPGRADE_HINT_RE)).toBeDefined();
	// The input is disabled so a command can't be silently swallowed.
	const input =
		within(container).getByLabelText<HTMLInputElement>("Shell command");
	expect(input.disabled).toBe(true);
});

it("shows a run-a-command hint once connected with no history yet", () => {
	publish({ enabled: true, events: [] });
	const { container } = render(<LocalAgentShellPane hidden={false} />);
	expect(within(container).getByText(EMPTY_HINT_RE)).toBeDefined();
});
