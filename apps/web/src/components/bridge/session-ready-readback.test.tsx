// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { getGitChannel } from "./git-channel-store";
import { SessionWorkspacePane } from "./session-workspace-pane";
import { Terminal } from "./terminal";
import {
	makeControllableTransport,
	SESSION,
	waitForConnect,
} from "./terminal-test-helpers";

// fix-caps-regression (end-to-end): resuming an old session delivered the
// CLI's permission_mode_changed/model_changed read-backs around the
// session_ready handshake, and 2068433's spread-fold fabricated a partial
// sessionReady from them — dropping `capabilities`, which gated the
// Git/Files/Shell tabs behind "CLI 版本过旧" and blanked the composer's model
// menu on a perfectly current CLI. These tests drive the REAL Terminal (and
// the kept-alive workspace pane) through both orderings.

// Git-specific so the assertion can't match the sibling Files/Shell panes'
// hints (all three panes stay mounted, hidden, beside the kept-alive chat).
const GIT_UPGRADE_HINT_RE = /暂不支持 Git 面板/;

/** A claude-code 0.7.x live handshake with the workspace capabilities on. */
const READY_DETAIL = {
	capabilities: {
		approval: "gated",
		busyModes: ["queue", "interrupt"],
		fs: true,
		git: true,
		images: true,
		mcp: "live",
		modelSwitch: true,
		permissionModes: ["default", "acceptEdits", "plan", "dontAsk"],
		quota: true,
		sessionOps: ["list"],
		shell: true,
		skills: true,
		slashCommands: true,
		thinkingLevels: [],
		usage: "stream",
	},
	cwd: "/repo",
	model: "sonnet",
	models: ["sonnet", "opus"],
	permissionMode: "default",
	sessionId: "claude-1",
};

const readyRaw = (id: number) => ({
	id,
	data: { detail: READY_DETAIL, kind: "status", status: "session_ready" },
});
const modeChangedRaw = (id: number, permissionMode: string) => ({
	id,
	data: {
		detail: { permissionMode },
		kind: "status",
		status: "permission_mode_changed",
	},
});
const modelChangedRaw = (id: number, model: string) => ({
	id,
	data: { detail: { model }, kind: "status", status: "model_changed" },
});

afterEach(() => {
	cleanup();
});

function triggerText(container: HTMLElement, name: string): string {
	return within(container).getByRole("combobox", { name }).textContent ?? "";
}

it("keeps the capability handshake intact when seeded history carries read-backs after session_ready", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{ seq: 1, event: readyRaw(1).data },
		{ seq: 2, event: modeChangedRaw(2, "plan").data },
		{ seq: 3, event: modelChangedRaw(3, "opus").data },
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);

	// The handshake's workspace capabilities survive the read-back folding —
	// the Git tab's channel stays enabled instead of gating on "版本过旧".
	await waitFor(() => {
		expect(getGitChannel()?.enabled).toBe(true);
	});
	// …and the composer menus track the read-back values.
	expect(triggerText(container, "Permission mode")).toContain("Plan");
	expect(triggerText(container, "Model")).toContain("opus");
});

it("recovers the full handshake when a read-back arrives BEFORE session_ready (乱序 backfill)", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	// The read-back lands first (the SDK pushes a status permissionMode early
	// on resume) — no partial sessionReady may be fabricated from it.
	await act(() => {
		fake.current()?.onEvent(modeChangedRaw(2, "plan"));
	});
	expect(getGitChannel()?.enabled).toBe(false);
	// Static-matrix fallback: the permission menu still renders for claude.
	expect(
		within(container).queryByRole("combobox", { name: "Permission mode" })
	).not.toBeNull();

	// The handshake backfills out of order (lower id) — capabilities go live
	// and the newer read-back's mode stays on top.
	await act(() => {
		fake.current()?.onEvent(readyRaw(1));
	});
	await waitFor(() => {
		expect(getGitChannel()?.enabled).toBe(true);
	});
	expect(triggerText(container, "Permission mode")).toContain("Plan");
	expect(triggerText(container, "Model")).toContain("sonnet");
});

it("survives tab switches (hidden→visible) with a read-back-only feed, then ungates once the handshake lands", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<SessionWorkspacePane
			chat={<Terminal session={SESSION} transport={fake.transport} />}
		/>
	);
	const view = within(container);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(modeChangedRaw(2, "plan"));
	});

	// Chat → Git: the pane shows the upgrade hint (no handshake yet), and the
	// kept-alive chat must not throw while hidden.
	fireEvent.click(view.getByRole("tab", { name: "Git" }));
	expect(view.getByText(GIT_UPGRADE_HINT_RE)).toBeDefined();

	// Git → Chat (the crash path): the composer is still there.
	fireEvent.click(view.getByRole("tab", { name: "Chat" }));
	expect(
		view.queryByRole("combobox", { name: "Permission mode" })
	).not.toBeNull();

	// The handshake lands late — the Git tab ungates without a remount.
	await act(() => {
		fake.current()?.onEvent(readyRaw(1));
	});
	fireEvent.click(view.getByRole("tab", { name: "Git" }));
	await waitFor(() => {
		expect(getGitChannel()?.enabled).toBe(true);
	});
	expect(view.queryByText(GIT_UPGRADE_HINT_RE)).toBeNull();
});
