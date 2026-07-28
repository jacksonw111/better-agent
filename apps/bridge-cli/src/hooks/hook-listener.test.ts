import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeState, PtyFrameType } from "@better-agent/api/pty/frame";
import { decodeFrame } from "@better-agent/api/pty/frame-decode";
import { expect, it, vi } from "vitest";
import { type HookEmitConn, runHookEmit } from "./hook-emit";
import { handleHookLine, startHookListener } from "./hook-listener";

const SID = "0f8fad5b-d9cb-469f-a165-70867728950e";

it("maps a known event line and emits its state", () => {
	const sendState = vi.fn();
	handleHookLine(JSON.stringify({ sessionId: SID, event: "Stop" }), sendState);
	expect(sendState).toHaveBeenCalledWith(SID, "idle");
});

it("emits nothing for an unknown event", () => {
	const sendState = vi.fn();
	handleHookLine(
		JSON.stringify({ sessionId: SID, event: "Mystery" }),
		sendState
	);
	expect(sendState).not.toHaveBeenCalled();
});

it("emits nothing for a malformed line or missing fields", () => {
	const sendState = vi.fn();
	handleHookLine("not json", sendState);
	handleHookLine(JSON.stringify({ event: "Stop" }), sendState);
	handleHookLine("", sendState);
	expect(sendState).not.toHaveBeenCalled();
});

it("the emitted state round-trips through the STATE frame codec", () => {
	const frame = encodeState(SID, "working");
	const decoded = decodeFrame(frame);
	expect(decoded?.type).toBe(PtyFrameType.STATE);
	if (decoded?.type === PtyFrameType.STATE) {
		expect(decoded.sessionId).toBe(SID);
		expect(decoded.state).toBe("working");
	}
});

it("receives a hook-emit line over a real unix socket and emits the state", async () => {
	const dir = mkdtempSync(join(tmpdir(), "bh-"));
	const socketPath = join(dir, "h.sock");
	const received: Array<{ sessionId: string; state: string }> = [];
	const listener = startHookListener({
		socketPath,
		sendState: (sessionId, state) => received.push({ sessionId, state }),
	});
	try {
		await runHookEmit("PreToolUse", {
			connect: (path) => createConnection(path) as unknown as HookEmitConn,
			readStdin: () => Promise.resolve(JSON.stringify({ session_id: SID })),
			socketPath,
		});
		// Give the server's connection 'end' handler a tick to fire.
		await new Promise((r) => setTimeout(r, 50));
		expect(received).toEqual([{ sessionId: SID, state: "working" }]);
	} finally {
		listener.close();
		rmSync(dir, { force: true, recursive: true });
	}
});
