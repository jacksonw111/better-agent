import { describe, expect, it, vi } from "vitest";
import {
	encodeActivity,
	encodeBind,
	encodeClose,
	encodeData,
	encodeKill,
	encodeLiveness,
	encodeOpen,
	encodeResize,
} from "./frame";
import { createPtyRelayHub, type PtyRelaySocket } from "./relay-hub";

const COMPUTER = "computer-1";
const SID_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SID_B = "1a1a1a1a-2b2b-3c3c-4d4d-5e5e5e5e5e5e";
const SPEC = { command: "cat", args: [], cwd: "/tmp" };

function recordingSocket() {
	const frames: Uint8Array[] = [];
	const socket: PtyRelaySocket = { send: (f) => frames.push(f) };
	return { socket, frames };
}

describe("pty relay hub — routing", () => {
	it("forwards viewer frames to the computer's agent socket", () => {
		const hub = createPtyRelayHub();
		const agent = recordingSocket();
		const viewer = recordingSocket();
		hub.connectAgent(COMPUTER, agent.socket);
		const conn = hub.connectViewer(COMPUTER, viewer.socket);
		const frame = encodeResize(SID_A, 40, 120);
		conn.handleFrame(frame);
		expect(agent.frames).toEqual([frame]);
	});

	it("fans an agent frame out only to viewers subscribed to that session", () => {
		const hub = createPtyRelayHub();
		const agent = recordingSocket();
		const viewerA = recordingSocket();
		const viewerB = recordingSocket();
		const agentConn = hub.connectAgent(COMPUTER, agent.socket);
		const connA = hub.connectViewer(COMPUTER, viewerA.socket);
		const connB = hub.connectViewer(COMPUTER, viewerB.socket);
		// A subscribes to SID_A, B subscribes to SID_B (OPEN frames).
		connA.handleFrame(encodeOpen(SID_A, 80, 24, SPEC));
		connB.handleFrame(encodeOpen(SID_B, 80, 24, SPEC));
		// Agent output for SID_A must reach only viewer A.
		const dataA = encodeData(SID_A, new TextEncoder().encode("hi"));
		agentConn.handleFrame(dataA);
		expect(viewerA.frames).toEqual([dataA]);
		expect(viewerB.frames).toEqual([]);
	});
});

describe("pty relay hub — subscription lifecycle", () => {
	it("stops delivering to a viewer after it CLOSEs the session", () => {
		const hub = createPtyRelayHub();
		const agent = recordingSocket();
		const viewer = recordingSocket();
		const agentConn = hub.connectAgent(COMPUTER, agent.socket);
		const conn = hub.connectViewer(COMPUTER, viewer.socket);
		conn.handleFrame(encodeOpen(SID_A, 80, 24, SPEC));
		conn.handleFrame(encodeClose(SID_A, 0));
		agentConn.handleFrame(encodeData(SID_A, new TextEncoder().encode("x")));
		expect(viewer.frames).toEqual([]);
	});

	it("drops a viewer's subscriptions when it disconnects", () => {
		const hub = createPtyRelayHub();
		const agent = recordingSocket();
		const viewer = recordingSocket();
		const agentConn = hub.connectAgent(COMPUTER, agent.socket);
		const conn = hub.connectViewer(COMPUTER, viewer.socket);
		conn.handleFrame(encodeOpen(SID_A, 80, 24, SPEC));
		expect(hub.viewerCount(COMPUTER)).toBe(1);
		conn.close();
		expect(hub.viewerCount(COMPUTER)).toBe(0);
		agentConn.handleFrame(encodeData(SID_A, new TextEncoder().encode("x")));
		expect(viewer.frames).toEqual([]);
	});
});

describe("pty relay hub — server-originated + control frames", () => {
	it("sendToAgent pushes a frame to the computer's CLI socket", () => {
		const hub = createPtyRelayHub();
		const agent = recordingSocket();
		hub.connectAgent(COMPUTER, agent.socket);
		const kill = encodeKill(SID_A);
		hub.sendToAgent(COMPUTER, kill);
		expect(agent.frames).toEqual([kill]);
	});

	it("sendToAgent is a no-op when no CLI is connected", () => {
		const hub = createPtyRelayHub();
		expect(() => hub.sendToAgent(COMPUTER, encodeKill(SID_A))).not.toThrow();
	});

	it("intercepts ACTIVITY frames (never fans them to viewers)", () => {
		const hub = createPtyRelayHub();
		const agent = recordingSocket();
		const viewer = recordingSocket();
		const onActivity = vi.fn();
		const agentConn = hub.connectAgent(COMPUTER, agent.socket, { onActivity });
		const viewerConn = hub.connectViewer(COMPUTER, viewer.socket);
		viewerConn.handleFrame(encodeOpen(SID_A, 80, 24, SPEC));
		agentConn.handleFrame(encodeActivity(SID_A));
		expect(onActivity).toHaveBeenCalledWith(COMPUTER, SID_A);
		expect(viewer.frames).toEqual([]);
	});

	it("intercepts LIVENESS frames and decodes the held session list", () => {
		const hub = createPtyRelayHub();
		const agent = recordingSocket();
		const onLiveness = vi.fn();
		const agentConn = hub.connectAgent(COMPUTER, agent.socket, { onLiveness });
		agentConn.handleFrame(encodeLiveness([SID_A, SID_B]));
		expect(onLiveness).toHaveBeenCalledWith(COMPUTER, [SID_A, SID_B]);
	});

	it("intercepts BIND frames and surfaces the agent session id (P25-C)", () => {
		const hub = createPtyRelayHub();
		const agent = recordingSocket();
		const viewer = recordingSocket();
		const onBind = vi.fn();
		const agentConn = hub.connectAgent(COMPUTER, agent.socket, { onBind });
		const viewerConn = hub.connectViewer(COMPUTER, viewer.socket);
		viewerConn.handleFrame(encodeOpen(SID_A, 80, 24, SPEC));
		agentConn.handleFrame(encodeBind(SID_A, "cap-123"));
		expect(onBind).toHaveBeenCalledWith(COMPUTER, SID_A, "cap-123");
		expect(viewer.frames).toEqual([]);
	});
});

describe("pty relay hub — agent replacement", () => {
	it("a replacement agent socket takes over; the stale one stops receiving", () => {
		const hub = createPtyRelayHub();
		const viewer = recordingSocket();
		const oldAgent = recordingSocket();
		const newAgent = recordingSocket();
		hub.connectAgent(COMPUTER, oldAgent.socket);
		hub.connectAgent(COMPUTER, newAgent.socket);
		const conn = hub.connectViewer(COMPUTER, viewer.socket);
		conn.handleFrame(encodeResize(SID_A, 40, 120));
		expect(newAgent.frames).toHaveLength(1);
		expect(oldAgent.frames).toEqual([]);
	});

	it("a stale agent closing does not evict the live replacement", () => {
		const hub = createPtyRelayHub();
		const viewer = recordingSocket();
		const oldAgent = recordingSocket();
		const newAgent = recordingSocket();
		const oldConn = hub.connectAgent(COMPUTER, oldAgent.socket);
		hub.connectAgent(COMPUTER, newAgent.socket);
		oldConn.close();
		const conn = hub.connectViewer(COMPUTER, viewer.socket);
		conn.handleFrame(encodeResize(SID_A, 40, 120));
		expect(newAgent.frames).toHaveLength(1);
	});
});
