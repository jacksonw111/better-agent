// PTY byte-transport frame protocol (DP-PTY2, phase-2 plan). One binary WS per
// computer carries every session's traffic; the 16-byte sessionId in each
// frame header is what multiplexes them. Deliberately Buffer-free (DataView +
// Uint8Array + TextEncoder only) so the SAME codec compiles for the browser
// xterm client in P2-2, not just the Node CLI/server.
//
// Wire layout (big-endian):
//   [type:u8][sessionId:16B raw UUID bytes][payload...]
//
// type:
//   0x01 DATA    payload = raw pty bytes                  (both directions)
//   0x02 RESIZE  payload = [rows:u16][cols:u16]           (web → CLI)
//   0x03 OPEN    payload = [cols:u16][rows:u16][spec?]    (web → CLI)
//                 spec = optional UTF-8 JSON {command,args,cwd}; absent = attach
//   0x04 CLOSE   payload = [exitCode:i32]  (-1 = unknown) (CLI → web)
//   0x05 ACK     payload = [consumedBytes:u64]            (web → CLI, flow ctl)
//   0x06 STATE   payload = UTF-8 status string            (CLI → web, phase 3)

export const PTY_SESSION_ID_LEN = 16;
export const PTY_FRAME_HEADER_LEN = 1 + PTY_SESSION_ID_LEN;

export const PtyFrameType = {
	DATA: 0x01,
	RESIZE: 0x02,
	OPEN: 0x03,
	CLOSE: 0x04,
	ACK: 0x05,
	STATE: 0x06,
} as const;
export type PtyFrameTypeValue =
	(typeof PtyFrameType)[keyof typeof PtyFrameType];

const MAX_U16 = 0xff_ff;
export const RESIZE_PAYLOAD_LEN = 4;
export const OPEN_HEAD_LEN = 4;
export const CLOSE_PAYLOAD_LEN = 4;
export const ACK_PAYLOAD_LEN = 8;
const CLOSE_UNKNOWN = -1;

const HEX_BYTE = /[0-9a-fA-F]{2}/g;
const encoder = new TextEncoder();

/** The spawn parameters an OPEN frame carries when it starts a NEW session
 * (absent on an attach — the CLI then just replays scrollback). */
export interface PtyOpenSpec {
	args: string[];
	command: string;
	cwd: string;
}

export type PtyFrame =
	| { type: typeof PtyFrameType.DATA; sessionId: string; data: Uint8Array }
	| {
			type: typeof PtyFrameType.RESIZE;
			sessionId: string;
			rows: number;
			cols: number;
	  }
	| {
			type: typeof PtyFrameType.OPEN;
			sessionId: string;
			cols: number;
			rows: number;
			spec: PtyOpenSpec | null;
	  }
	| { type: typeof PtyFrameType.CLOSE; sessionId: string; exitCode: number }
	| { type: typeof PtyFrameType.ACK; sessionId: string; consumedBytes: number }
	| { type: typeof PtyFrameType.STATE; sessionId: string; state: string };

function clampU16(n: number): number {
	return Math.max(0, Math.min(MAX_U16, Math.trunc(n)));
}

/** Canonical UUID string → its 16 raw bytes. Throws on a non-UUID string so a
 * caller can't silently ship a truncated/garbage sessionId. */
export function uuidToBytes(uuid: string): Uint8Array {
	const hex = uuid.replace(/-/g, "");
	if (hex.length !== PTY_SESSION_ID_LEN * 2) {
		throw new Error(`pty: not a UUID: ${uuid}`);
	}
	const matches = hex.match(HEX_BYTE);
	if (!matches || matches.length !== PTY_SESSION_ID_LEN) {
		throw new Error(`pty: not a UUID: ${uuid}`);
	}
	return Uint8Array.from(matches, (byte) => Number.parseInt(byte, 16));
}

/** 16 raw bytes → canonical lowercase UUID string (8-4-4-4-12). */
export function bytesToUuid(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function withHeader(
	type: PtyFrameTypeValue,
	sessionId: string,
	payloadLen: number
): { bytes: Uint8Array; view: DataView; payloadAt: number } {
	const bytes = new Uint8Array(PTY_FRAME_HEADER_LEN + payloadLen);
	bytes[0] = type;
	bytes.set(uuidToBytes(sessionId), 1);
	return {
		bytes,
		view: new DataView(bytes.buffer),
		payloadAt: PTY_FRAME_HEADER_LEN,
	};
}

export function encodeData(sessionId: string, data: Uint8Array): Uint8Array {
	const { bytes, payloadAt } = withHeader(
		PtyFrameType.DATA,
		sessionId,
		data.length
	);
	bytes.set(data, payloadAt);
	return bytes;
}

export function encodeResize(
	sessionId: string,
	rows: number,
	cols: number
): Uint8Array {
	const { bytes, view, payloadAt } = withHeader(
		PtyFrameType.RESIZE,
		sessionId,
		RESIZE_PAYLOAD_LEN
	);
	view.setUint16(payloadAt, clampU16(rows));
	view.setUint16(payloadAt + 2, clampU16(cols));
	return bytes;
}

export function encodeOpen(
	sessionId: string,
	cols: number,
	rows: number,
	spec: PtyOpenSpec | null
): Uint8Array {
	const specBytes = spec
		? encoder.encode(JSON.stringify(spec))
		: new Uint8Array(0);
	const { bytes, view, payloadAt } = withHeader(
		PtyFrameType.OPEN,
		sessionId,
		OPEN_HEAD_LEN + specBytes.length
	);
	view.setUint16(payloadAt, clampU16(cols));
	view.setUint16(payloadAt + 2, clampU16(rows));
	bytes.set(specBytes, payloadAt + OPEN_HEAD_LEN);
	return bytes;
}

export function encodeClose(sessionId: string, exitCode: number): Uint8Array {
	const { bytes, view, payloadAt } = withHeader(
		PtyFrameType.CLOSE,
		sessionId,
		CLOSE_PAYLOAD_LEN
	);
	view.setInt32(
		payloadAt,
		Number.isFinite(exitCode) ? exitCode : CLOSE_UNKNOWN
	);
	return bytes;
}

export function encodeAck(
	sessionId: string,
	consumedBytes: number
): Uint8Array {
	const { bytes, view, payloadAt } = withHeader(
		PtyFrameType.ACK,
		sessionId,
		ACK_PAYLOAD_LEN
	);
	view.setBigUint64(payloadAt, BigInt(Math.max(0, Math.trunc(consumedBytes))));
	return bytes;
}

export function encodeState(sessionId: string, state: string): Uint8Array {
	const stateBytes = encoder.encode(state);
	const { bytes, payloadAt } = withHeader(
		PtyFrameType.STATE,
		sessionId,
		stateBytes.length
	);
	bytes.set(stateBytes, payloadAt);
	return bytes;
}

/** The frame's type byte, or null if the buffer is too short to be a frame. */
export function peekType(frame: Uint8Array): PtyFrameTypeValue | null {
	if (frame.length < PTY_FRAME_HEADER_LEN) {
		return null;
	}
	return frame[0] as PtyFrameTypeValue;
}

/** The frame's sessionId (as a UUID string) without decoding its payload —
 * all the server relay needs to route a frame. Null if too short. */
export function peekSessionId(frame: Uint8Array): string | null {
	if (frame.length < PTY_FRAME_HEADER_LEN) {
		return null;
	}
	return bytesToUuid(frame.subarray(1, PTY_FRAME_HEADER_LEN));
}
