// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import { makeControllableTransport, SESSION } from "./terminal-test-helpers";

// Phase 2: the curated `session_ready` and `turn_usage` status events carry
// session metadata (capabilities, cost/tokens) and must render as dedicated
// header/chip UI — never as an inline chat row (see bridge-turns.ts,
// session-status-header.tsx, turn-usage-panel.tsx). Seeded via
// `transport.history` (like terminal-history.test.tsx) since these render
// as soon as the feed is seeded, with no live SSE interaction needed.

const SESSION_READY_DETAIL = {
	model: "claude-opus-4-6",
	cwd: "/Users/john/project",
	permissionMode: "acceptEdits",
	tools: ["Bash", "Read", "Edit"],
	slashCommands: ["/compact", "/clear"],
	skills: ["web-design"],
	mcpServers: [
		{ name: "docs", status: "connected" },
		{ name: "search", status: "failed" },
	],
};

const SESSION_LABEL_PATTERN = /Session:/;

const TURN_USAGE_DETAIL = {
	costUsd: 0.012_345,
	numTurns: 3,
	durationMs: 4500,
	usage: {
		// claude's SDK emits snake_case keys; the parser maps these to the
		// camelCase interface (see bridge-session-status.ts's parseUsageTokens).
		input_tokens: 1234,
		output_tokens: 567,
		cache_read_input_tokens: 8000,
		cache_creation_input_tokens: 200,
	},
	isError: false,
};

it("renders session_ready as the status header, not a chat row", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "session_ready",
				detail: SESSION_READY_DETAIL,
			},
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);

	await waitFor(() => {
		// Reported model now also shows as the composer's read-only model label,
		// so it appears in more than one place — assert presence, not uniqueness.
		expect(view.getAllByText("claude-opus-4-6").length).toBeGreaterThan(0);
	});
	expect(view.getByText("acceptEdits")).toBeDefined();
	expect(view.getByText("3 tools · 2 commands · 1 skills")).toBeDefined();
	expect(view.getByTitle("docs: connected")).toBeDefined();
	expect(view.getByTitle("search: failed")).toBeDefined();
	// This is metadata, not a message: the raw status name must never appear
	// anywhere on the page (it used to, via the generic StatusLine).
	expect(view.queryByText("session_ready")).toBeNull();
});

it("shows the claude session id prominently in the header, never the label", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "session_ready",
				detail: { ...SESSION_READY_DETAIL, sessionId: "claude-session-xyz123" },
			},
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);

	// The prominent `Session: <id>` header, with the full id in its tooltip —
	// preferring the claude session id off `session_ready`.
	await waitFor(() => {
		expect(view.getByTitle("claude-session-xyz123")).toBeDefined();
	});
	expect(view.getByText(SESSION_LABEL_PATTERN)).toBeDefined();
	// The bridge session `label` ("my-repo") must never surface as the title.
	expect(view.queryByText("my-repo")).toBeNull();
});

it("falls back to the bridge session id in the header before session_ready arrives", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);

	await waitFor(() => {
		expect(view.getByTitle("session-1")).toBeDefined();
	});
	expect(view.queryByText("my-repo")).toBeNull();
});

it("renders turn_usage as the usage panel with cost + token breakdown, not a chat row", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "turn_usage",
				detail: TURN_USAGE_DETAIL,
			},
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);

	await waitFor(() => {
		expect(view.getByText("$0.0123")).toBeDefined();
	});
	// Each token bucket is its own labeled stat, not a single packed line.
	expect(view.getByText("Input")).toBeDefined();
	expect(view.getByText("1.2k")).toBeDefined();
	expect(view.getByText("Output")).toBeDefined();
	expect(view.getByText("567")).toBeDefined();
	expect(view.getByText("Cache read")).toBeDefined();
	expect(view.getByText("8.0k")).toBeDefined();
	expect(view.getByText("4.5s")).toBeDefined();
	expect(view.queryByText("turn_usage")).toBeNull();
});

it("still renders a normal assistant message as a chat bubble", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: { kind: "message", role: "assistant", text: "Hello there" },
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);

	await waitFor(() => {
		expect(view.getByText("Hello there")).toBeDefined();
	});
});

it("feeds the composer's '/' picker from session_ready's slashCommands/skills", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "session_ready",
				detail: SESSION_READY_DETAIL,
			},
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);

	await waitFor(() => {
		// Reported model now also shows as the composer's read-only model label,
		// so it appears in more than one place — assert presence, not uniqueness.
		expect(view.getAllByText("claude-opus-4-6").length).toBeGreaterThan(0);
	});
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;
	fireEvent.change(textarea, { target: { value: "/" } });

	expect(view.getByRole("option", { name: "compact" })).toBeDefined();
	expect(view.getByRole("option", { name: "web-design" })).toBeDefined();
});

// R5-T2: the "/" picker's command source upgrades to the live command_catalog
// status event (R5-T1) once an adapter has pushed one, instead of staying
// pinned to session_ready's static slashCommands snapshot forever.
it("prefers the live command_catalog over session_ready's slashCommands once one has arrived", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "session_ready",
				detail: SESSION_READY_DETAIL,
			},
		},
		{
			seq: 2,
			event: {
				kind: "status",
				status: "command_catalog",
				detail: { commands: [{ name: "review" }, { name: "deploy" }] },
			},
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);

	await waitFor(() => {
		expect(view.getAllByText("claude-opus-4-6").length).toBeGreaterThan(0);
	});
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;
	fireEvent.change(textarea, { target: { value: "/" } });

	expect(view.getByRole("option", { name: "review" })).toBeDefined();
	expect(view.getByRole("option", { name: "deploy" })).toBeDefined();
	// The stale session_ready snapshot no longer leaks through once the live
	// catalog has replaced it.
	expect(view.queryByRole("option", { name: "compact" })).toBeNull();
});

it("shows no '/' picker before session_ready has arrived", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);
	const textarea = (await waitFor(() =>
		view.getByLabelText("Message")
	)) as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "/" } });

	expect(view.queryByRole("listbox")).toBeNull();
});
