import { describe, expect, it, vi } from "vitest";
import { connectJsonRpc } from "./jsonrpc-io";
import { opencodeAdapter } from "./opencode";
import { createFakeRpc } from "./opencode-test-harness";

// R2-b: the opencode adapter applies the bridge token's persisted startup
// config (model + permissionMode) right after `session/new`, via the same
// ACP methods the live setModel/setPermissionMode controls already use. Split
// out of opencode.test.ts to keep that file under the 300-line limit.

vi.mock("./jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));

describe("opencodeAdapter - startup config (R2-b)", () => {
	it("applies the persisted model + permissionMode right after session/new, via the same ACP methods as the live controls", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		await opencodeAdapter.start("/tmp/project", {
			config: { model: "anthropic/claude-sonnet-4", permissionMode: "plan" },
		});

		expect(rpc.request).toHaveBeenCalledWith("unstable_setSessionModel", {
			sessionId: "session_1",
			model: "anthropic/claude-sonnet-4",
		});
		expect(rpc.request).toHaveBeenCalledWith("session/set_mode", {
			sessionId: "session_1",
			mode: "plan",
		});
	});

	it("issues no model/mode requests when no startup config is given", async () => {
		const { rpc } = createFakeRpc();
		vi.mocked(connectJsonRpc).mockResolvedValue(rpc);

		await opencodeAdapter.start("/tmp/project");

		expect(rpc.request).not.toHaveBeenCalledWith(
			"unstable_setSessionModel",
			expect.anything()
		);
		expect(rpc.request).not.toHaveBeenCalledWith(
			"session/set_mode",
			expect.anything()
		);
	});
});
