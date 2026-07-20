import { expect, it, vi } from "vitest";
import { claudeCodeAdapter } from "./claude-code";
import { mockQuery, nextEvent } from "./claude-code-test-harness";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

// Repro (resume-caps investigation, 2026-07-19): claude's `system/init` line —
// until now the adapter's ONLY `session_ready` source — does not arrive in
// streaming-input mode until the FIRST user turn. A resumed session (and an
// empty-description chat, neither of which auto-sends anything at launch)
// therefore left the web handshake-less indefinitely: `resolveCapabilities`
// fell back to its static matrix, gating Git/Files/Shell behind "CLI 版本过旧"
// and hiding the composer's model/permission pickers on a fully current CLI.
// Verified against the real stack: the resumed session's bridge_messages held
// no session_ready until a turn was sent. These specs pin the fix — start()
// emits a startup handshake built from the SDK control channel (which resolves
// BEFORE init; measured ~3.9s on a real machine) + the persisted startup
// config, and the real init later re-emits the full detail, which the web fold
// takes wholesale.

it("emits a startup session_ready as the FIRST event, before any SDK message", async () => {
	mockQuery([{ value: "opus" }, { value: "sonnet" }]);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	expect(await nextEvent(iterator)).toMatchObject({
		kind: "status",
		status: "session_ready",
		detail: {
			cwd: "/tmp/project",
			models: ["opus", "sonnet"],
			capabilities: {
				fs: true,
				git: true,
				shell: true,
				modelSwitch: true,
			},
		},
	});
});

it("omits model and permissionMode entirely when the startup config sets neither", async () => {
	// The SDK exposes no read for either value, so an unconfigured launch has
	// NOTHING truthful to report: the user's own settings decide the mode
	// (`permissions.defaultMode` need not be "default") and this process can't
	// see them. Reporting a guessed "default" put a possibly-wrong mode in the
	// composer; omitting leaves the menu neutral until init supplies the truth.
	mockQuery([{ value: "opus" }]);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	const event = await nextEvent(iterator);
	const detail = (event as { detail: Record<string, unknown> }).detail;
	expect(detail.permissionMode).toBeUndefined();
	expect(detail.model).toBeUndefined();
});

it("reflects the persisted startup config's model (alias-resolved) and permissionMode", async () => {
	mockQuery([{ resolvedModel: "claude-opus-4", value: "opus" }]);
	const handle = await claudeCodeAdapter.start("/tmp/project", {
		config: { model: "claude-opus-4", permissionMode: "plan" },
	});
	const iterator = handle.events[Symbol.asyncIterator]();

	expect(await nextEvent(iterator)).toMatchObject({
		kind: "status",
		status: "session_ready",
		detail: { model: "opus", permissionMode: "plan" },
	});
});

it("still emits the handshake (capabilities, no models) when supportedModels fails", async () => {
	const { harness } = mockQuery();
	harness.supportedModels.mockRejectedValue(new Error("control channel down"));
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	const event = await nextEvent(iterator);
	expect(event).toMatchObject({ kind: "status", status: "session_ready" });
	const detail = (event as { detail: Record<string, unknown> }).detail;
	expect(detail.models).toBeUndefined();
	expect(detail.capabilities).toMatchObject({ fs: true, git: true });
});

it("carries no sessionId — claude's conversation id only exists once init arrives", async () => {
	// captureAgentSessionId / the server's maybePersistAgentSessionId must not
	// see a fabricated id: the startup handshake omits the field entirely and
	// the real init's session_ready supplies it later.
	mockQuery([{ value: "opus" }]);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	const event = await nextEvent(iterator);
	const detail = (event as { detail: Record<string, unknown> }).detail;
	expect("sessionId" in detail).toBe(false);
});

it("the real init still emits the full session_ready afterwards", async () => {
	const { harness } = mockQuery([{ value: "opus" }]);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();
	await nextEvent(iterator); // the startup handshake

	harness.yieldMessage({
		type: "system",
		subtype: "init",
		session_id: "sess-1",
		model: "claude-opus-4",
		permissionMode: "acceptEdits",
	});

	expect(await nextEvent(iterator)).toMatchObject({
		kind: "status",
		status: "session_ready",
		detail: { sessionId: "sess-1", permissionMode: "acceptEdits" },
	});
});
