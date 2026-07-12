import { describe, expect, it } from "vitest";
import {
	agentWsUrl,
	parseVncTarget,
	type RelaySocket,
	startVncRelay,
} from "./vnc-relay";

describe("parseVncTarget", () => {
	it("parses vnc:// with a port", () => {
		expect(parseVncTarget("vnc://127.0.0.1:59001")).toEqual({
			host: "127.0.0.1",
			port: 59_001,
		});
	});

	it("strips credentials", () => {
		expect(parseVncTarget("vnc://:secret@localhost:5901")).toEqual({
			host: "localhost",
			port: 5901,
		});
	});

	it("defaults a scheme-less host:port and bare host", () => {
		expect(parseVncTarget("192.168.64.2:5902")).toEqual({
			host: "192.168.64.2",
			port: 5902,
		});
		expect(parseVncTarget("192.168.64.2")).toEqual({
			host: "192.168.64.2",
			port: 5900,
		});
	});

	it("returns null for empty/garbage", () => {
		expect(parseVncTarget("")).toBeNull();
		expect(parseVncTarget("   ")).toBeNull();
	});
});

describe("agentWsUrl", () => {
	it("converts http→ws and https→wss, trimming trailing slashes", () => {
		expect(agentWsUrl("https://api.example.com/", "s1")).toBe(
			"wss://api.example.com/bridge/vnc/agent/s1"
		);
		expect(agentWsUrl("http://localhost:3000", "s2")).toBe(
			"ws://localhost:3000/bridge/vnc/agent/s2"
		);
	});
});

interface FakeSocket extends RelaySocket {
	closed: boolean;
	emit: (data: Uint8Array | string) => void;
	fireClose: () => void;
	received: (Uint8Array | string)[];
}

function fakeSocket(): FakeSocket {
	let dataCb: ((d: Uint8Array | string) => void) | null = null;
	let closeCb: (() => void) | null = null;
	return {
		closed: false,
		received: [],
		send(data) {
			this.received.push(data);
		},
		onData(cb) {
			dataCb = cb;
		},
		onClose(cb) {
			closeCb = cb;
		},
		close() {
			this.closed = true;
		},
		emit(data) {
			dataCb?.(data);
		},
		fireClose() {
			closeCb?.();
		},
	};
}

describe("startVncRelay", () => {
	function setup() {
		const ws = fakeSocket();
		const tcp = fakeSocket();
		const relay = startVncRelay(
			{
				sessionId: "sess",
				serverUrl: "http://localhost:3000",
				token: "bt_test",
				vncUrl: "vnc://127.0.0.1:59001",
			},
			{
				connectWs: () => ws,
				connectTcp: () => tcp,
			}
		);
		return { ws, tcp, relay };
	}

	it("pipes bytes both ways", () => {
		const { ws, tcp } = setup();
		tcp.emit(new Uint8Array([1, 2, 3]));
		expect(ws.received).toHaveLength(1);
		ws.emit("client-input");
		expect(tcp.received).toContain("client-input");
	});

	it("tears down the other side when one closes", () => {
		const { ws, tcp } = setup();
		tcp.fireClose();
		expect(ws.closed).toBe(true);
		expect(tcp.closed).toBe(true);
	});

	it("stop() closes both", () => {
		const { ws, tcp, relay } = setup();
		relay.stop();
		expect(ws.closed).toBe(true);
		expect(tcp.closed).toBe(true);
	});

	it("throws on an unparseable VNC url", () => {
		expect(() =>
			startVncRelay(
				{ sessionId: "s", serverUrl: "http://x", token: "t", vncUrl: "  " },
				{ connectWs: () => fakeSocket(), connectTcp: () => fakeSocket() }
			)
		).toThrow("Unparseable VNC URL");
	});
});
