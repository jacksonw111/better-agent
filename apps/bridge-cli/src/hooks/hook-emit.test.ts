import { expect, it, vi } from "vitest";
import { type HookEmitConn, type HookEmitDeps, runHookEmit } from "./hook-emit";

const SID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** A fake connection that records what was written and lets a test drive its
 * "connect"/"error" events. */
function fakeConn() {
	const listeners = new Map<string, () => void>();
	const conn: HookEmitConn & {
		written: string | null;
		destroyed: boolean;
		fire: (event: "connect" | "error") => void;
	} = {
		written: null,
		destroyed: false,
		end(data: string) {
			this.written = data;
		},
		destroy() {
			this.destroyed = true;
		},
		on(event, listener) {
			listeners.set(event, listener);
		},
		fire(event) {
			listeners.get(event)?.();
		},
	};
	return conn;
}

function deps(over: Partial<HookEmitDeps> = {}): HookEmitDeps {
	return {
		connect: () => fakeConn(),
		readStdin: () => Promise.resolve("{}"),
		socketPath: "/tmp/x.sock",
		...over,
	};
}

it("writes a compact line with the argv event + stdin session id, then closes", async () => {
	const conn = fakeConn();
	const stdin = JSON.stringify({ session_id: SID, cwd: "/repo" });
	await runHookEmit(
		"PreToolUse",
		deps({ connect: () => conn, readStdin: () => Promise.resolve(stdin) })
	);
	// deliver awaits the "connect" event before writing.
	conn.fire("connect");
	expect(conn.written).not.toBeNull();
	const parsed = JSON.parse((conn.written ?? "").trim());
	expect(parsed).toEqual({ sessionId: SID, event: "PreToolUse" });
});

it("includes source and reason when present", async () => {
	const conn = fakeConn();
	const stdin = JSON.stringify({
		session_id: SID,
		source: "resume",
		reason: "clear",
	});
	await runHookEmit(
		"SessionEnd",
		deps({ connect: () => conn, readStdin: () => Promise.resolve(stdin) })
	);
	conn.fire("connect");
	const parsed = JSON.parse((conn.written ?? "").trim());
	expect(parsed).toEqual({
		sessionId: SID,
		event: "SessionEnd",
		source: "resume",
		reason: "clear",
	});
});

it("does not connect when stdin carries no session id", async () => {
	const connect = vi.fn(() => fakeConn());
	await runHookEmit(
		"Stop",
		deps({ connect, readStdin: () => Promise.resolve("{}") })
	);
	expect(connect).not.toHaveBeenCalled();
});

it("does not connect on malformed stdin (and never throws)", async () => {
	const connect = vi.fn(() => fakeConn());
	await expect(
		runHookEmit(
			"Stop",
			deps({ connect, readStdin: () => Promise.resolve("not json") })
		)
	).resolves.toBeUndefined();
	expect(connect).not.toHaveBeenCalled();
});

it("resolves (exit 0) when the socket connect throws — fire-and-forget", async () => {
	const connect = () => {
		throw new Error("ENOENT: no such socket");
	};
	await expect(
		runHookEmit(
			"Stop",
			deps({
				connect,
				readStdin: () => Promise.resolve(JSON.stringify({ session_id: SID })),
			})
		)
	).resolves.toBeUndefined();
});

it("resolves on a connection error without writing", async () => {
	const conn = fakeConn();
	await runHookEmit(
		"Stop",
		deps({
			connect: () => conn,
			readStdin: () => Promise.resolve(JSON.stringify({ session_id: SID })),
		})
	);
	conn.fire("error");
	expect(conn.written).toBeNull();
});

it("gives up after the timeout when connect never fires", async () => {
	const conn = fakeConn();
	const immediateTimeout = ((fn: () => void) => {
		fn();
		return {
			unref() {
				// no-op timer handle
			},
		};
	}) as unknown as typeof setTimeout;
	await expect(
		runHookEmit(
			"Stop",
			deps({
				connect: () => conn,
				readStdin: () => Promise.resolve(JSON.stringify({ session_id: SID })),
				setTimeoutFn: immediateTimeout,
			})
		)
	).resolves.toBeUndefined();
	expect(conn.destroyed).toBe(true);
});
