import { describe, expect, it } from "vitest";
import {
	bytesToUuid,
	decodeLivenessSessionIds,
	encodeAck,
	encodeActivity,
	encodeBind,
	encodeClose,
	encodeData,
	encodeKill,
	encodeLiveness,
	encodeOpen,
	encodeResize,
	encodeState,
	PtyFrameType,
	peekSessionId,
	peekType,
	uuidToBytes,
} from "./frame";
import { decodeFrame } from "./frame-decode";

const SID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SID_B = "1a1a1a1a-2b2b-3c3c-4d4d-5e5e5e5e5e5e";

describe("uuid <-> bytes", () => {
	it("round-trips a UUID through 16 raw bytes", () => {
		const bytes = uuidToBytes(SID);
		expect(bytes).toHaveLength(16);
		expect(bytesToUuid(bytes)).toBe(SID);
	});

	it("rejects a non-UUID string", () => {
		expect(() => uuidToBytes("nope")).toThrow();
	});
});

describe("DATA frame", () => {
	it("round-trips raw bytes", () => {
		const data = new Uint8Array([0, 1, 2, 253, 254, 255]);
		const decoded = decodeFrame(encodeData(SID, data));
		expect(decoded).toEqual({ type: PtyFrameType.DATA, sessionId: SID, data });
	});

	it("round-trips an empty payload", () => {
		const decoded = decodeFrame(encodeData(SID, new Uint8Array(0)));
		expect(decoded?.type).toBe(PtyFrameType.DATA);
		if (decoded?.type === PtyFrameType.DATA) {
			expect(decoded.data).toHaveLength(0);
		}
	});
});

describe("RESIZE frame", () => {
	it("round-trips rows/cols", () => {
		const decoded = decodeFrame(encodeResize(SID, 40, 120));
		expect(decoded).toEqual({
			type: PtyFrameType.RESIZE,
			sessionId: SID,
			rows: 40,
			cols: 120,
		});
	});

	it("clamps oversized dimensions to u16", () => {
		const decoded = decodeFrame(encodeResize(SID, 99_999, 99_999));
		if (decoded?.type === PtyFrameType.RESIZE) {
			expect(decoded.rows).toBe(0xff_ff);
			expect(decoded.cols).toBe(0xff_ff);
		}
	});
});

describe("OPEN frame", () => {
	it("round-trips a spawn spec (new session)", () => {
		const spec = { command: "cat", args: ["-u"], cwd: "/tmp" };
		const decoded = decodeFrame(encodeOpen(SID, 80, 24, spec));
		expect(decoded).toEqual({
			type: PtyFrameType.OPEN,
			sessionId: SID,
			cols: 80,
			rows: 24,
			spec,
		});
	});

	it("carries a null spec (attach) with just the winsize", () => {
		const decoded = decodeFrame(encodeOpen(SID, 100, 30, null));
		expect(decoded).toEqual({
			type: PtyFrameType.OPEN,
			sessionId: SID,
			cols: 100,
			rows: 30,
			spec: null,
		});
	});

	it("round-trips the P25-C binding fields (create-vs-resume)", () => {
		const spec = {
			command: "codex",
			args: [],
			cwd: "/repo",
			agentKind: "codex",
			agentSessionId: "cap-123",
			agentSessionStarted: true,
		};
		const decoded = decodeFrame(encodeOpen(SID, 80, 24, spec));
		if (decoded?.type === PtyFrameType.OPEN) {
			expect(decoded.spec).toEqual(spec);
		} else {
			throw new Error("expected an OPEN frame");
		}
	});
});

describe("BIND frame", () => {
	it("round-trips the underlying agent's resumable id", () => {
		const decoded = decodeFrame(encodeBind(SID, "019fa2b0-f899-7493"));
		expect(decoded).toEqual({
			type: PtyFrameType.BIND,
			sessionId: SID,
			agentSessionId: "019fa2b0-f899-7493",
		});
	});
});

describe("CLOSE frame", () => {
	it("round-trips an exit code", () => {
		const decoded = decodeFrame(encodeClose(SID, 7));
		expect(decoded).toEqual({
			type: PtyFrameType.CLOSE,
			sessionId: SID,
			exitCode: 7,
		});
	});

	it("encodes an unknown exit code as -1", () => {
		const decoded = decodeFrame(encodeClose(SID, Number.NaN));
		if (decoded?.type === PtyFrameType.CLOSE) {
			expect(decoded.exitCode).toBe(-1);
		}
	});
});

describe("ACK frame", () => {
	it("round-trips a large cumulative byte count", () => {
		const decoded = decodeFrame(encodeAck(SID, 5_000_000_000));
		expect(decoded).toEqual({
			type: PtyFrameType.ACK,
			sessionId: SID,
			consumedBytes: 5_000_000_000,
		});
	});
});

describe("STATE frame", () => {
	it("round-trips a status string", () => {
		const decoded = decodeFrame(encodeState(SID, "running"));
		expect(decoded).toEqual({
			type: PtyFrameType.STATE,
			sessionId: SID,
			state: "running",
		});
	});
});

describe("KILL frame", () => {
	it("round-trips as a header-only frame", () => {
		const decoded = decodeFrame(encodeKill(SID));
		expect(decoded).toEqual({ type: PtyFrameType.KILL, sessionId: SID });
	});
});

describe("ACTIVITY frame", () => {
	it("round-trips as a header-only frame", () => {
		const decoded = decodeFrame(encodeActivity(SID));
		expect(decoded).toEqual({ type: PtyFrameType.ACTIVITY, sessionId: SID });
	});
});

describe("LIVENESS frame", () => {
	it("packs and unpacks a list of held sessionIds", () => {
		const frame = encodeLiveness([SID, SID_B]);
		expect(peekType(frame)).toBe(PtyFrameType.LIVENESS);
		expect(decodeLivenessSessionIds(frame)).toEqual([SID, SID_B]);
	});

	it("round-trips an empty list (CLI holds no ptys)", () => {
		expect(decodeLivenessSessionIds(encodeLiveness([]))).toEqual([]);
	});

	it("returns [] for a non-LIVENESS frame", () => {
		expect(
			decodeLivenessSessionIds(encodeData(SID, new Uint8Array(0)))
		).toEqual([]);
	});
});

describe("peek helpers", () => {
	it("read type + sessionId without decoding the payload", () => {
		const frame = encodeData(SID, new Uint8Array([1, 2, 3]));
		expect(peekType(frame)).toBe(PtyFrameType.DATA);
		expect(peekSessionId(frame)).toBe(SID);
	});
});

describe("malformed frames", () => {
	it("returns null for a buffer shorter than the header", () => {
		expect(decodeFrame(new Uint8Array(5))).toBeNull();
		expect(peekType(new Uint8Array(5))).toBeNull();
		expect(peekSessionId(new Uint8Array(5))).toBeNull();
	});

	it("returns null for a RESIZE with the wrong payload length", () => {
		const bad = encodeResize(SID, 40, 120).subarray(0, 18);
		expect(decodeFrame(bad)).toBeNull();
	});

	it("returns null for an unknown type byte", () => {
		const frame = encodeData(SID, new Uint8Array(0));
		frame[0] = 0x7f;
		expect(decodeFrame(frame)).toBeNull();
	});
});
