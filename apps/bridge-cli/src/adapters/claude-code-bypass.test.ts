import { query } from "@anthropic-ai/claude-agent-sdk";
import { expect, it, vi } from "vitest";
import { claudeCodeAdapter } from "./claude-code";
import { mockQuery } from "./claude-code-test-harness";

// Full-auto bypassPermissions (owner request): split into its own file from
// claude-code.test.ts to keep both under the repo's 300-line-per-file cap. The
// SDK's `allowDangerouslySkipPermissions` gate that PERMITS the mode is
// spawn-only (no runtime control request), so the adapter sets it on every
// session — otherwise a LIVE switch into full-auto would be silently refused.

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

it("setPermissionMode() forwards a LIVE switch to bypassPermissions (full-auto)", async () => {
	// It's now an accepted mode, and the session was spawned with
	// allowDangerouslySkipPermissions so the runtime switch actually takes
	// effect rather than being refused.
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.setPermissionMode?.("bypassPermissions");
	expect(harness.setPermissionMode).toHaveBeenCalledExactlyOnceWith(
		"bypassPermissions"
	);
});

it("always spawns query() with allowDangerouslySkipPermissions so bypass can take effect", async () => {
	mockQuery();
	await claudeCodeAdapter.start("/tmp/project");

	expect(vi.mocked(query)).toHaveBeenLastCalledWith(
		expect.objectContaining({
			options: expect.objectContaining({
				allowDangerouslySkipPermissions: true,
			}),
		})
	);
});

it("passes a startup bypassPermissions config straight through to query()", async () => {
	mockQuery();
	await claudeCodeAdapter.start("/tmp/project", {
		config: { permissionMode: "bypassPermissions" },
	});

	expect(vi.mocked(query)).toHaveBeenLastCalledWith(
		expect.objectContaining({
			options: expect.objectContaining({
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
			}),
		})
	);
});
