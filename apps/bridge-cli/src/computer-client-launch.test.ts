import { describe, expect, it, vi } from "vitest";
import { runComputerClient } from "./computer-client";
import {
	clientArgs,
	fakeDeps,
	fakeTransport,
	waitTimes,
} from "./computer-client-test-helpers";

// S25-T1: the client loop's launch-delivery seams. Heartbeat
// `pendingCommands` feed the (optional) launch handler without blocking the
// beat; the control channel opens once the identity is resolved; and a
// client wired WITHOUT launch deps keeps heartbeating — the heartbeat-only
// degradation D4 requires. The launch pipeline itself is covered in
// task-launch/.

const pendingLaunch = {
	agentKind: "claude-code" as const,
	description: "d",
	issueSnapshots: [],
	kind: "launch" as const,
	repositoryUrl: null,
	runId: "run-1",
	sessionCredential: "bt_x",
	taskId: "task-1",
	workspace: { kind: "standalone" as const },
};

describe("runComputerClient - launch delivery (S25-T1)", () => {
	it("hands heartbeat pendingCommands to the launch handler and settles it", async () => {
		const transport = fakeTransport();
		transport.heartbeat.mockResolvedValueOnce({
			pendingCommands: [pendingLaunch],
		});
		const launchHandler = {
			handle: vi.fn(() => Promise.resolve()),
			settle: vi.fn(() => Promise.resolve()),
		};

		await runComputerClient(
			clientArgs(),
			fakeDeps({ launchHandler, transport, wait: waitTimes(1) })
		);

		expect(launchHandler.handle).toHaveBeenCalledExactlyOnceWith(pendingLaunch);
		expect(launchHandler.settle).toHaveBeenCalledTimes(1);
	});

	it("opens the control channel with the resolved identity", async () => {
		const startControlChannel = vi.fn();
		await runComputerClient(
			clientArgs(),
			fakeDeps({ startControlChannel, wait: waitTimes(0) })
		);
		expect(startControlChannel).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ computerId: "computer-9" })
		);
	});

	it("keeps heartbeating without launch deps (heartbeat-only degradation)", async () => {
		const transport = fakeTransport();
		transport.heartbeat.mockResolvedValue({
			pendingCommands: [pendingLaunch],
		});
		await runComputerClient(
			clientArgs(),
			fakeDeps({ transport, wait: waitTimes(2) })
		);
		expect(transport.heartbeat).toHaveBeenCalledTimes(2);
	});
});

describe("runComputerClient - clone delivery (Q2)", () => {
	it("hands heartbeat clone_project commands to the clone handler", async () => {
		const pendingClone = {
			kind: "clone_project" as const,
			projectId: "project-1",
			repoCloneUrl: "https://github.com/acme/app.git",
		};
		const transport = fakeTransport();
		transport.heartbeat.mockResolvedValueOnce({
			pendingCommands: [pendingClone, pendingLaunch],
		});
		const cloneHandler = { handle: vi.fn(() => Promise.resolve()) };
		const launchHandler = {
			handle: vi.fn(() => Promise.resolve()),
			settle: vi.fn(() => Promise.resolve()),
		};

		await runComputerClient(
			clientArgs(),
			fakeDeps({ cloneHandler, launchHandler, transport, wait: waitTimes(1) })
		);

		expect(cloneHandler.handle).toHaveBeenCalledExactlyOnceWith(pendingClone);
		expect(launchHandler.handle).toHaveBeenCalledExactlyOnceWith(pendingLaunch);
	});
});
