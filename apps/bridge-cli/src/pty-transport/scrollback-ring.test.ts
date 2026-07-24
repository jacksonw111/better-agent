import { describe, expect, it } from "vitest";
import { createScrollbackRing } from "./scrollback-ring";

function bytes(str: string): Uint8Array {
	return new TextEncoder().encode(str);
}

function text(buf: Uint8Array): string {
	return new TextDecoder().decode(buf);
}

describe("scrollback ring", () => {
	it("replays everything from offset 0 while under capacity", () => {
		const ring = createScrollbackRing(1024);
		ring.append(bytes("hello "));
		ring.append(bytes("world"));
		expect(ring.producedOffset).toBe(11);
		expect(text(ring.bytesFrom(0))).toBe("hello world");
	});

	it("returns only the tail from a mid-stream cursor (reconnect resume)", () => {
		const ring = createScrollbackRing(1024);
		ring.append(bytes("abcdef"));
		expect(text(ring.bytesFrom(4))).toBe("ef");
	});

	it("returns empty from a cursor at or past the end", () => {
		const ring = createScrollbackRing(1024);
		ring.append(bytes("abc"));
		expect(ring.bytesFrom(3)).toHaveLength(0);
		expect(ring.bytesFrom(99)).toHaveLength(0);
	});

	it("evicts the oldest bytes past capacity but keeps producedOffset absolute", () => {
		const ring = createScrollbackRing(4);
		ring.append(bytes("abcd"));
		ring.append(bytes("ef"));
		expect(ring.producedOffset).toBe(6);
		expect(ring.size).toBe(4);
		// "ab" evicted; window is now "cdef" at absolute offsets 2..6.
		expect(text(ring.bytesFrom(0))).toBe("cdef");
		expect(text(ring.bytesFrom(4))).toBe("ef");
	});

	it("caps a single oversized write to capacity", () => {
		const ring = createScrollbackRing(4);
		ring.append(bytes("abcdefgh"));
		expect(ring.size).toBe(4);
		expect(text(ring.bytesFrom(0))).toBe("efgh");
	});
});
