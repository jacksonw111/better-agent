// @vitest-environment jsdom
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BashCommandCard } from "./bash-command-card";

function tool(partial: Partial<ToolInvocation>): ToolInvocation {
	return {
		callId: "c1",
		toolName: "Bash",
		args: { command: "npm test" },
		isError: false,
		status: "complete",
		...partial,
	};
}

/** The disclosure header is always the FIRST button — the copy button only
 * exists inside the expanded output panel, after it. */
function headerOf(scope: ReturnType<typeof within>) {
	return scope.getAllByRole("button")[0];
}

function renderCard(t: ToolInvocation) {
	const utils = render(<BashCommandCard tool={t} />);
	return { ...utils, scope: within(utils.container) };
}

function mockClipboard() {
	const writeText = vi.fn(() => Promise.resolve());
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	return writeText;
}

it("renders the $ prefix and the command text", () => {
	const { scope } = renderCard(tool({ result: "ok" }));
	expect(scope.getByText("$")).toBeDefined();
	expect(scope.getByText("npm test")).toBeDefined();
});

it("is not expandable while running with no output yet", () => {
	const { scope } = renderCard(tool({ status: "running" }));
	const header = scope.getByRole("button");
	expect(header.hasAttribute("disabled")).toBe(true);
	expect(header.getAttribute("aria-expanded")).toBeNull();
});

it("shows the last line of a running command's live preview as a tail", () => {
	const { scope } = renderCard(
		tool({ status: "running", preview: "compiling…\ndone: src/a.ts\n" })
	);
	expect(scope.getByText("done: src/a.ts")).toBeDefined();
});

it("expands to the inline output with a line count", () => {
	const { container, scope } = renderCard(
		tool({ result: "line a\nline b\nline c" })
	);
	fireEvent.click(headerOf(scope));
	expect(container.querySelector("pre")?.textContent).toBe(
		"line a\nline b\nline c"
	);
	expect(scope.getByText("3 lines")).toBeDefined();
});

it("labels a single-line output as 1 line", () => {
	const { scope } = renderCard(tool({ result: "ok" }));
	fireEvent.click(headerOf(scope));
	expect(scope.getByText("1 line")).toBeDefined();
});

it("copies the full output via the copy button", async () => {
	const writeText = mockClipboard();
	const { scope } = renderCard(tool({ result: "line a\nline b" }));
	fireEvent.click(headerOf(scope));
	fireEvent.click(scope.getByLabelText("Copy output"));
	expect(writeText).toHaveBeenCalledWith("line a\nline b");
	expect(await scope.findByText("Copied")).toBeDefined();
});

it("auto-expands an errored command that already has output", () => {
	const { scope } = renderCard(
		tool({ status: "error", isError: true, result: "exit code 1" })
	);
	expect(headerOf(scope).getAttribute("aria-expanded")).toBe("true");
	expect(scope.getByText("exit code 1")).toBeDefined();
});

it("auto-expands ONCE when an error's output lands after mount", () => {
	const running = tool({ status: "running", args: { command: "false" } });
	const failed = tool({
		args: { command: "false" },
		status: "error",
		isError: true,
		result: "exit code 1",
	});
	const { container, rerender } = render(<BashCommandCard tool={running} />);
	const scope = within(container);
	// Output arrives late, with the failure → the card pops open by itself.
	rerender(<BashCommandCard tool={failed} />);
	expect(headerOf(scope).getAttribute("aria-expanded")).toBe("true");
	// The user collapses it — later re-renders must NOT pop it open again.
	fireEvent.click(headerOf(scope));
	expect(headerOf(scope).getAttribute("aria-expanded")).toBe("false");
	rerender(<BashCommandCard tool={{ ...failed }} />);
	expect(headerOf(scope).getAttribute("aria-expanded")).toBe("false");
});

it("never auto-expands after the user already toggled the card themselves", () => {
	const done = tool({ result: "fine" });
	const { container, rerender } = render(<BashCommandCard tool={done} />);
	const scope = within(container);
	fireEvent.click(headerOf(scope));
	fireEvent.click(headerOf(scope));
	// A failure arriving after a manual toggle stays collapsed.
	rerender(
		<BashCommandCard
			tool={tool({ status: "error", isError: true, result: "boom" })}
		/>
	);
	expect(headerOf(scope).getAttribute("aria-expanded")).toBe("false");
});

it("does not auto-expand a successful command's late output", () => {
	const running = tool({ status: "running" });
	const { container, rerender } = render(<BashCommandCard tool={running} />);
	const scope = within(container);
	rerender(<BashCommandCard tool={tool({ result: "all good" })} />);
	expect(headerOf(scope).getAttribute("aria-expanded")).toBe("false");
	expect(scope.queryByText("all good")).toBeNull();
});

it("keeps a persistent one-line error preview visible while collapsed", () => {
	const { scope } = renderCard(
		tool({ status: "error", isError: true, result: "exit code 1\ndetails" })
	);
	// Auto-expanded; collapse and the first error line must stay visible.
	fireEvent.click(headerOf(scope));
	expect(headerOf(scope).getAttribute("aria-expanded")).toBe("false");
	expect(scope.getByText("exit code 1")).toBeDefined();
});

it("shows a completed call's duration on the header", () => {
	const { scope } = renderCard(tool({ result: "hi", durationMs: 3100 }));
	expect(scope.getByText("3.1s")).toBeDefined();
});
