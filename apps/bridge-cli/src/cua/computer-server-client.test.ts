import { describe, expect, it } from "vitest";
import {
	createComputerServerClient,
	type WebSocketLike,
} from "./computer-server-client";

/** A controllable in-memory WebSocket that records outbound frames and lets a
 * test drive open/message/close events. No real socket is ever opened. */
class FakeWebSocket implements WebSocketLike {
	static instances: FakeWebSocket[] = [];
	closed = false;
	onclose: ((event?: unknown) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onopen: ((event?: unknown) => void) | null = null;
	sent: string[] = [];
	readonly url: string;

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed = true;
	}

	open(): void {
		this.onopen?.();
	}

	reply(payload: Record<string, unknown>): void {
		this.onmessage?.({ data: JSON.stringify(payload) });
	}
}

function firstFrame(socket: FakeWebSocket): unknown {
	return JSON.parse(socket.sent[0] ?? "null");
}

function makeConnectedClient() {
	FakeWebSocket.instances = [];
	const client = createComputerServerClient({
		url: "ws://127.0.0.1:8000/ws",
		wsImpl: FakeWebSocket as unknown as new (url: string) => WebSocketLike,
	});
	const connected = client.connect();
	const socket = FakeWebSocket.instances[0];
	if (!socket) {
		throw new Error("fake socket was not constructed");
	}
	socket.open();
	return { client, connected, socket };
}

describe("createComputerServerClient", () => {
	it("connects once the socket opens", async () => {
		const { connected, socket } = makeConnectedClient();
		await connected;
		expect(socket.url).toBe("ws://127.0.0.1:8000/ws");
	});

	it("sends a {command, params} envelope and resolves on {success:true}", async () => {
		const { client, connected, socket } = makeConnectedClient();
		await connected;

		const pending = client.send("left_click", { x: 10, y: 20 });
		expect(firstFrame(socket)).toEqual({
			command: "left_click",
			params: { x: 10, y: 20 },
		});

		socket.reply({ success: true, clicked: true });
		await expect(pending).resolves.toEqual({ success: true, clicked: true });
	});

	it("defaults params to an empty object when omitted", async () => {
		const { client, connected, socket } = makeConnectedClient();
		await connected;

		const pending = client.send("get_accessibility_tree");
		expect(firstFrame(socket)).toEqual({
			command: "get_accessibility_tree",
			params: {},
		});
		socket.reply({ success: true, windows: [] });
		await pending;
	});

	it("rejects when the server replies {success:false}", async () => {
		const { client, connected, socket } = makeConnectedClient();
		await connected;

		const pending = client.send("press_key", { key: "enter" });
		socket.reply({ success: false, error: "no focused window" });
		await expect(pending).rejects.toThrow("no focused window");
	});
});

describe("createComputerServerClient - lifecycle", () => {
	it("matches replies to requests in FIFO order", async () => {
		const { client, connected, socket } = makeConnectedClient();
		await connected;

		const first = client.send("type_text", { text: "a" });
		const second = client.send("type_text", { text: "b" });
		socket.reply({ success: true, id: 1 });
		socket.reply({ success: true, id: 2 });

		await expect(first).resolves.toEqual({ success: true, id: 1 });
		await expect(second).resolves.toEqual({ success: true, id: 2 });
	});

	it("rejects sends made before connecting", async () => {
		const client = createComputerServerClient({
			url: "ws://127.0.0.1:8000/ws",
			wsImpl: FakeWebSocket as unknown as new (url: string) => WebSocketLike,
		});
		await expect(client.send("type_text", { text: "x" })).rejects.toThrow(
			"not connected"
		);
	});

	it("fails in-flight requests when the socket closes", async () => {
		const { client, connected, socket } = makeConnectedClient();
		await connected;

		const pending = client.send("type_text", { text: "x" });
		socket.onclose?.();
		await expect(pending).rejects.toThrow("connection closed");
	});
});
