import { describe, expect, it } from "vitest";
import { encodeClose, encodeData, encodeOpen, encodeResize } from "./frame";
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
