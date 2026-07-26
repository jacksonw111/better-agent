import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	encodeData,
	encodeKill,
	encodeOpen,
	type PtyFrame,
	PtyFrameType,
} from "@better-agent/api/pty/frame";
import { decodeFrame } from "@better-agent/api/pty/frame-decode";
import { createPtyRelayHub } from "@better-agent/api/pty/relay-hub";
import { beforeAll, describe, expect, it } from "vitest";
import { spawnPty } from "../pty/spawn-pty";
import {
	createPtySessionManager,
	type PtySpawnFn,
} from "./pty-session-manager";

// Full byte-path E2E (Slice P2-1 acceptance): a test "viewer" client drives
// frames through the REAL server relay hub → the CLI session manager → a REAL
// pty (compiled pty-broker running sh/cat) → output bytes flow back through the
// hub to the viewer. The only thing stubbed out is the WS socket itself (its
// reconnect/handshake is covered by pty-ws-transport.test.ts); every byte here
// goes through the actual frame codec, relay routing and a live pty.

const COMPUTER = "computer-e2e";
const SID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const brokerSrc = fileURLToPath(
	new URL("../../native/pty-broker.c", import.meta.url)
);
let realBroker: string | undefined;

beforeAll(() => {
	try {
		const dir = mkdtempSync(join(tmpdir(), "pty-e2e-"));
		const out = join(dir, "pty-broker");
		execFileSync("cc", ["-O2", "-o", out, brokerSrc], { stdio: "pipe" });
		if (existsSync(out)) {
			realBroker = out;
		}
	} catch {
		realBroker = undefined;
	}
});

/** Wires viewer ⇄ hub ⇄ CLI manager (real broker) in one process. */
function wireE2E() {
	const hub = createPtyRelayHub();
	const received: PtyFrame[] = [];
	const viewer = hub.connectViewer(COMPUTER, {
		send: (frame) => {
			const decoded = decodeFrame(frame);
			if (decoded) {
				received.push(decoded);
			}
		},
	});
	// The agent socket delivers viewer→CLI frames into the manager; the manager's
	// own output is pushed back into the hub as if it came from the agent WS.
	const spawn: PtySpawnFn = (spec, cols, rows) =>
		spawnPty(spec.command, spec.args, spec.cwd, cols, rows, {
			brokerPath: realBroker,
		});
	// Reassigned once below; declared first so the manager's send closure can
	// reference it (circular: agentConn ↔ manager).
	let agentConn: ReturnType<typeof hub.connectAgent>;
	const manager = createPtySessionManager({
		send: (frame) => agentConn.handleFrame(frame),
		spawn,
	});
	agentConn = hub.connectAgent(COMPUTER, {
		send: (frame) => {
			const decoded = decodeFrame(frame);
			if (decoded) {
				manager.handleFrame(decoded);
			}
		},
	});
	return { received, viewer };
}

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (predicate()) {
				resolve();
				return;
			}
			if (Date.now() - started > timeoutMs) {
				reject(new Error("waitFor timed out"));
				return;
			}
			setTimeout(tick, 10);
		};
		tick();
	});
}

function dataText(received: PtyFrame[]): string {
	return received
		.filter((f) => f.type === PtyFrameType.DATA)
		.map((f) =>
			f.type === PtyFrameType.DATA ? new TextDecoder().decode(f.data) : ""
		)
		.join("");
}

describe("pty transport E2E (real broker)", () => {
	it("streams real pty output back to the viewer and reports the exit code", async () => {
		if (!realBroker) {
			expect(realBroker ?? "cc unavailable").toBeTruthy();
			return;
		}
		const { received, viewer } = wireE2E();
		viewer.handleFrame(
			encodeOpen(SID, 80, 24, {
				command: "sh",
				args: ["-c", "printf DATACHECK; exit 3"],
				cwd: process.cwd(),
			})
		);
		await waitFor(() => received.some((f) => f.type === PtyFrameType.CLOSE));
		expect(dataText(received)).toContain("DATACHECK");
		const close = received.find((f) => f.type === PtyFrameType.CLOSE);
		expect(close).toEqual({
			type: PtyFrameType.CLOSE,
			sessionId: SID,
			exitCode: 3,
		});
	}, 15_000);

	it("round-trips keystrokes through a live cat pty", async () => {
		if (!realBroker) {
			expect(realBroker ?? "cc unavailable").toBeTruthy();
			return;
		}
		const { received, viewer } = wireE2E();
		viewer.handleFrame(
			encodeOpen(SID, 80, 24, { command: "cat", args: [], cwd: process.cwd() })
		);
		viewer.handleFrame(encodeData(SID, new TextEncoder().encode("ping\n")));
		await waitFor(() => dataText(received).includes("ping"));
		expect(dataText(received)).toContain("ping");
		viewer.handleFrame(encodeKill(SID)); // tear the cat pty down (endSession)
	}, 15_000);
});
