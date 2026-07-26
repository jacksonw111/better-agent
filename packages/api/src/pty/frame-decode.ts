// PTY frame decoding (DP-PTY2), split from frame.ts to keep each file under the
// repo's 300-line cap. Encoding + protocol constants/types live in ./frame; the
// decode path — one dispatcher plus per-type payload validators — lives here.

import {
	ACK_PAYLOAD_LEN,
	bytesToUuid,
	CLOSE_PAYLOAD_LEN,
	OPEN_HEAD_LEN,
	PTY_FRAME_HEADER_LEN,
	type PtyFrame,
	PtyFrameType,
	type PtyOpenSpec,
	peekType,
	RESIZE_PAYLOAD_LEN,
} from "./frame";

const decoder = new TextDecoder();

function decodeOpenSpec(payload: Uint8Array): PtyOpenSpec | null {
	if (payload.length <= OPEN_HEAD_LEN) {
		return null;
	}
	try {
		const parsed = JSON.parse(decoder.decode(payload.subarray(OPEN_HEAD_LEN)));
		if (
			parsed &&
			typeof parsed.command === "string" &&
			typeof parsed.cwd === "string" &&
			Array.isArray(parsed.args)
		) {
			return {
				command: parsed.command,
				args: parsed.args.map(String),
				cwd: parsed.cwd,
			};
		}
	} catch {
		return null;
	}
	return null;
}

function decodeResizeFrame(
	sessionId: string,
	view: DataView,
	payload: Uint8Array
): PtyFrame | null {
	if (payload.length !== RESIZE_PAYLOAD_LEN) {
		return null;
	}
	return {
		type: PtyFrameType.RESIZE,
		sessionId,
		rows: view.getUint16(0),
		cols: view.getUint16(2),
	};
}

function decodeOpenFrame(
	sessionId: string,
	view: DataView,
	payload: Uint8Array
): PtyFrame | null {
	if (payload.length < OPEN_HEAD_LEN) {
		return null;
	}
	return {
		type: PtyFrameType.OPEN,
		sessionId,
		cols: view.getUint16(0),
		rows: view.getUint16(2),
		spec: decodeOpenSpec(payload),
	};
}

function decodeCloseFrame(
	sessionId: string,
	view: DataView,
	payload: Uint8Array
): PtyFrame | null {
	if (payload.length !== CLOSE_PAYLOAD_LEN) {
		return null;
	}
	return { type: PtyFrameType.CLOSE, sessionId, exitCode: view.getInt32(0) };
}

function decodeAckFrame(
	sessionId: string,
	view: DataView,
	payload: Uint8Array
): PtyFrame | null {
	if (payload.length !== ACK_PAYLOAD_LEN) {
		return null;
	}
	return {
		type: PtyFrameType.ACK,
		sessionId,
		consumedBytes: Number(view.getBigUint64(0)),
	};
}

/** Decodes one whole frame, or null for anything malformed (too short for its
 * type, bad payload length) — the transport drops a bad frame, never throws. */
export function decodeFrame(frame: Uint8Array): PtyFrame | null {
	const type = peekType(frame);
	if (type === null) {
		return null;
	}
	const sessionId = bytesToUuid(frame.subarray(1, PTY_FRAME_HEADER_LEN));
	const payload = frame.subarray(PTY_FRAME_HEADER_LEN);
	const view = new DataView(
		frame.buffer,
		frame.byteOffset + PTY_FRAME_HEADER_LEN,
		payload.length
	);
	switch (type) {
		case PtyFrameType.DATA:
			return { type, sessionId, data: payload };
		case PtyFrameType.RESIZE:
			return decodeResizeFrame(sessionId, view, payload);
		case PtyFrameType.OPEN:
			return decodeOpenFrame(sessionId, view, payload);
		case PtyFrameType.CLOSE:
			return decodeCloseFrame(sessionId, view, payload);
		case PtyFrameType.ACK:
			return decodeAckFrame(sessionId, view, payload);
		case PtyFrameType.STATE:
			return { type, sessionId, state: decoder.decode(payload) };
		case PtyFrameType.KILL:
			return { type, sessionId };
		case PtyFrameType.ACTIVITY:
			return { type, sessionId };
		default:
			return null;
	}
}
