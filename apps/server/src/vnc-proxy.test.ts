import { describe, expect, it } from "vitest";
import {
	createVncProxyRegistry,
	type ProxySocket,
	type VncData,
} from "./vnc-proxy";

/** In-memory ProxySocket that records what it was sent and lets a test drive
 * its inbound message / close callbacks — no real WebSocket involved. */
function fakeSocket(): {
	socket: ProxySocket;
	sent: VncData[];
	closed: () => boolean;
	emit: (data: VncData) => void;
	fireClose: () => void;
} {
	const sent: VncData[] = [];
	let messageCb: ((data: VncData) => void) | null = null;
	let closeCb: (() => void) | null = null;
	let isClosed = false;
	const socket: ProxySocket = {
		send: (data) => sent.push(data),
		close: () => {
			if (isClosed) {
				return;
			}
			isClosed = true;
			closeCb?.();
		},
		onMessage: (cb) => {
			messageCb = cb;
		},
		onClose: (cb) => {
			closeCb = cb;
		},
	};
	return {
		socket,
		sent,
		closed: () => isClosed,
		emit: (data) => messageCb?.(data),
		fireClose: () => socket.close(),
	};
}

const SESSION = "session-1";

describe("createVncProxyRegistry piping", () => {
	it("pipes a message each way once producer and consumer are paired", () => {
		const registry = createVncProxyRegistry();
		const producer = fakeSocket();
		const consumer = fakeSocket();

		registry.attachProducer(SESSION, producer.socket);
		registry.attachConsumer(SESSION, consumer.socket);

		producer.emit("framebuffer");
		consumer.emit("client-input");

		expect(consumer.sent).toEqual(["framebuffer"]);
		expect(producer.sent).toEqual(["client-input"]);
	});

	it("closes the consumer when the producer closes, and clears the pair", () => {
		const registry = createVncProxyRegistry();
		const producer = fakeSocket();
		const consumer = fakeSocket();
		registry.attachProducer(SESSION, producer.socket);
		registry.attachConsumer(SESSION, consumer.socket);

		producer.fireClose();

		expect(consumer.closed()).toBe(true);
		expect(registry.activeSessionCount()).toBe(0);
	});

	it("closes the producer when the consumer closes", () => {
		const registry = createVncProxyRegistry();
		const producer = fakeSocket();
		const consumer = fakeSocket();
		registry.attachProducer(SESSION, producer.socket);
		registry.attachConsumer(SESSION, consumer.socket);

		consumer.fireClose();

		expect(producer.closed()).toBe(true);
		expect(registry.activeSessionCount()).toBe(0);
	});
});

describe("createVncProxyRegistry lifecycle", () => {
	it("drops consumer messages sent before a producer exists", () => {
		const registry = createVncProxyRegistry();
		const consumer = fakeSocket();
		registry.attachConsumer(SESSION, consumer.socket);

		// No producer yet: this input has nowhere to go and is dropped.
		consumer.emit("early-input");

		const producer = fakeSocket();
		registry.attachProducer(SESSION, producer.socket);
		// The early message was not buffered/replayed to the late producer.
		expect(producer.sent).toEqual([]);

		consumer.emit("later-input");
		expect(producer.sent).toEqual(["later-input"]);
	});

	it("replaces a duplicate producer: the stale one is closed, the new one is live", () => {
		const registry = createVncProxyRegistry();
		const first = fakeSocket();
		const second = fakeSocket();
		const consumer = fakeSocket();
		registry.attachProducer(SESSION, first.socket);
		registry.attachConsumer(SESSION, consumer.socket);

		registry.attachProducer(SESSION, second.socket);

		// Stale producer is closed but its teardown does NOT close the consumer,
		// because it is no longer the active producer for the pair.
		expect(first.closed()).toBe(true);
		expect(consumer.closed()).toBe(false);
		expect(registry.activeSessionCount()).toBe(1);

		// The stale producer's traffic is ignored; the new one pipes through.
		first.emit("stale");
		second.emit("fresh");
		expect(consumer.sent).toEqual(["fresh"]);
	});
});
