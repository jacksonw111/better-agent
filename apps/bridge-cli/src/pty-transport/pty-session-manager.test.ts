import { homedir } from "node:os";
import {
	decodeLivenessSessionIds,
	encodeAck,
	encodeClose,
	encodeData,
	encodeKill,
	encodeOpen,
	encodeResize,
	PtyFrameType,
} from "@better-agent/api/pty/frame";
import { decodeFrame } from "@better-agent/api/pty/frame-decode";
import { describe, expect, it, vi } from "vitest";
import type { PtyHandle } from "../pty/spawn-pty";
import { spawnPty } from "../pty/spawn-pty";
import { bytes, SID, SPEC, setup } from "./pty-session-harness";
import { createPtySessionManager } from "./pty-session-manager";

vi.mock("../pty/spawn-pty", () => ({
	spawnPty: vi.fn(),
}));

describe("pty session manager — open & io", () => {
	it("OPEN with a spec spawns a pty at the requested winsize", () => {
		const { spawn, feed, manager } = setup();
		feed(encodeOpen(SID, 80, 24, SPEC));
		expect(spawn).toHaveBeenCalledWith(SPEC, 80, 24);
		expect(manager.sessionCount).toBe(1);
	});

	it("routes DATA keystrokes into the pty and RESIZE to the pty", () => {
		const { fake, feed } = setup();
		feed(encodeOpen(SID, 80, 24, SPEC));
		feed(encodeData(SID, bytes("ls\n")));
		expect(fake.handle.write).toHaveBeenCalledWith(Buffer.from("ls\n"));
		feed(encodeResize(SID, 40, 120));
		expect(fake.handle.resize).toHaveBeenCalledWith(120, 40);
	});
});

describe("pty session manager — output & exit", () => {
	it("emits pty output as DATA frames back to the viewer", () => {
		const { fake, feed, sent } = setup();
		feed(encodeOpen(SID, 80, 24, SPEC));
		fake.emitData(bytes("hello"));
		const dataFrames = sent.filter((f) => f.type === PtyFrameType.DATA);
		expect(dataFrames).toHaveLength(1);
		if (dataFrames[0]?.type === PtyFrameType.DATA) {
			expect(new TextDecoder().decode(dataFrames[0].data)).toBe("hello");
		}
	});

	it("emits CLOSE with the exit code when the pty exits", () => {
		const { fake, feed, sent, manager } = setup();
		feed(encodeOpen(SID, 80, 24, SPEC));
		fake.emitExit(7);
		const close = sent.find((f) => f.type === PtyFrameType.CLOSE);
		expect(close).toEqual({
			type: PtyFrameType.CLOSE,
			sessionId: SID,
			exitCode: 7,
		});
		expect(manager.sessionCount).toBe(0);
	});
});

describe("pty session manager — scrollback & flow control", () => {
	it("replays scrollback as a bulk DATA burst on reattach", () => {
		const { fake, feed, sent } = setup();
		feed(encodeOpen(SID, 80, 24, SPEC));
		fake.emitData(bytes("line1\n"));
		fake.emitData(bytes("line2\n"));
		const before = sent.length;
		// A second OPEN (no spec) is an attach — expect the backlog replayed.
		feed(encodeOpen(SID, 80, 24, null));
		const burst = sent.slice(before).find((f) => f.type === PtyFrameType.DATA);
		if (burst?.type === PtyFrameType.DATA) {
			expect(new TextDecoder().decode(burst.data)).toBe("line1\nline2\n");
		} else {
			throw new Error("expected a scrollback DATA burst");
		}
	});

	it("pauses the pty past HIGH_WATER and resumes under LOW_WATER via ACK", () => {
		const { fake, feed } = setup({ highWaterBytes: 100, lowWaterBytes: 40 });
		feed(encodeOpen(SID, 80, 24, SPEC));
		// Produce 150 bytes with no ACK: in-flight 150 > 100 → pause.
		fake.emitData(new Uint8Array(150));
		expect(fake.handle.pause).toHaveBeenCalledTimes(1);
		expect(fake.handle.resume).not.toHaveBeenCalled();
		// ACK 120 consumed → in-flight 30 < 40 → resume.
		feed(encodeAck(SID, 120));
		expect(fake.handle.resume).toHaveBeenCalledTimes(1);
	});
});

describe("pty session manager — reconnect & teardown", () => {
	it("resumes from the ACK cursor after a reconnect (no gap, no full replay)", () => {
		const { fake, feed, sent, manager } = setup();
		feed(encodeOpen(SID, 80, 24, SPEC));
		fake.emitData(bytes("aaaa")); // offsets 0..4
		fake.emitData(bytes("bbbb")); // offsets 4..8
		feed(encodeAck(SID, 4)); // viewer consumed "aaaa"
		const before = sent.length;
		manager.onReconnect();
		const resumed = sent
			.slice(before)
			.find((f) => f.type === PtyFrameType.DATA);
		if (resumed?.type === PtyFrameType.DATA) {
			expect(new TextDecoder().decode(resumed.data)).toBe("bbbb");
		} else {
			throw new Error("expected a resume DATA burst from the ack cursor");
		}
	});

	it("CLOSE from the viewer is a DETACH — the pty stays alive (P25-A)", () => {
		const { fake, feed, manager } = setup();
		feed(encodeOpen(SID, 80, 24, SPEC));
		feed(encodeClose(SID, 0));
		expect(fake.handle.kill).not.toHaveBeenCalled();
		expect(manager.sessionCount).toBe(1);
	});

	it("KILL tears the pty down (endSession)", () => {
		const { fake, feed } = setup();
		feed(encodeOpen(SID, 80, 24, SPEC));
		feed(encodeKill(SID));
		expect(fake.handle.kill).toHaveBeenCalledTimes(1);
	});

	it("a second OPEN reattaches the existing pty — no respawn (P25-A)", () => {
		const { spawn, feed, manager } = setup();
		feed(encodeOpen(SID, 80, 24, SPEC));
		feed(encodeOpen(SID, 80, 24, null));
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(manager.sessionCount).toBe(1);
	});

	it("ignores an attach to a session that was never opened", () => {
		const { spawn, feed, manager } = setup();
		feed(encodeOpen(SID, 80, 24, null));
		expect(spawn).not.toHaveBeenCalled();
		expect(manager.sessionCount).toBe(0);
	});
});

describe("pty session manager — activity (P25-A)", () => {
	it("emits an ACTIVITY frame on first output, then throttles", () => {
		let clock = 1000;
		const { fake, feed, sent } = setup({
			activityThrottleMs: 5000,
			now: () => clock,
		});
		feed(encodeOpen(SID, 80, 24, SPEC));
		fake.emitData(bytes("a"));
		fake.emitData(bytes("b")); // same instant → throttled
		expect(sent.filter((f) => f.type === PtyFrameType.ACTIVITY)).toHaveLength(
			1
		);
		clock += 6000; // past the throttle window
		fake.emitData(bytes("c"));
		expect(sent.filter((f) => f.type === PtyFrameType.ACTIVITY)).toHaveLength(
			2
		);
	});

	it("emits ACTIVITY on reattach regardless of the throttle", () => {
		const clock = 1000;
		const { fake, feed, sent } = setup({
			activityThrottleMs: 5000,
			now: () => clock,
		});
		feed(encodeOpen(SID, 80, 24, SPEC));
		fake.emitData(bytes("a")); // 1st ACTIVITY
		// Reattach immediately (within the throttle) still counts as activity.
		feed(encodeOpen(SID, 80, 24, null));
		expect(
			sent.filter((f) => f.type === PtyFrameType.ACTIVITY).length
		).toBeGreaterThanOrEqual(2);
		expect(clock).toBe(1000);
	});
});

describe("pty session manager — liveness (P25-A)", () => {
	it("reportLiveness lists exactly the sessions holding a pty", () => {
		const { feed, raw, manager } = setup();
		feed(encodeOpen(SID, 80, 24, SPEC));
		const before = raw.length;
		manager.reportLiveness();
		const frame = raw[before];
		if (!frame) {
			throw new Error("expected a LIVENESS frame");
		}
		expect(decodeLivenessSessionIds(frame)).toEqual([SID]);
		expect(manager.liveSessionIds()).toEqual([SID]);
	});

	it("reportLiveness is empty when the CLI holds no ptys (post-restart)", () => {
		const { raw, manager } = setup();
		manager.reportLiveness();
		const frame = raw.at(-1);
		if (!frame) {
			throw new Error("expected a LIVENESS frame");
		}
		expect(decodeLivenessSessionIds(frame)).toEqual([]);
	});
});

describe("pty session manager — default spawn (P2-3a)", () => {
	it("resolves an empty cwd to the user's home directory", () => {
		const mockedSpawn = vi.mocked(spawnPty);
		mockedSpawn.mockReturnValue({
			onData: () => undefined,
			onExit: () => undefined,
		} as unknown as PtyHandle);
		// No `spawn` override → the manager uses its real defaultSpawn, which must
		// turn `cwd: ""` (a home-directory terminal) into an absolute home path.
		const manager = createPtySessionManager({ send: () => undefined });
		const decoded = decodeFrame(
			encodeOpen(SID, 80, 24, { command: "claude", args: [], cwd: "" })
		);
		if (decoded) {
			manager.handleFrame(decoded);
		}
		expect(mockedSpawn).toHaveBeenCalledWith("claude", [], homedir(), 80, 24);
	});
});
