// DP-PTY3: a per-session bounded ring of the most recent pty output bytes, kept
// on the CLI daemon (the server never stores scrollback). Two jobs:
//   1. reattach — a web viewer sending OPEN gets `bytesFrom(0)` replayed as a
//      bulk burst before live output resumes.
//   2. reconnect resume — after the CLI's WS drops and comes back, each live
//      session replays `bytesFrom(ackedBytes)` so the viewer continues from
//      exactly where its last ACK left off (the gap is bounded by capacity).
//
// Bytes are addressed by ABSOLUTE offset (cumulative bytes ever produced), so a
// cursor stays valid even as the oldest bytes are evicted.

export const DEFAULT_SCROLLBACK_BYTES = 256 * 1024;

interface Segment {
	bytes: Uint8Array;
	/** Absolute offset of this segment's first byte. */
	offset: number;
}

export interface ScrollbackRing {
	/** Appends pty output, evicting the oldest bytes past the capacity. */
	append(chunk: Uint8Array): void;
	/** Retained bytes from `offset` (absolute) to the end, concatenated. Bytes
	 * already evicted below the retained window are silently skipped — the
	 * caller gets the freshest suffix it still can. */
	bytesFrom(offset: number): Uint8Array;
	/** Absolute offset one past the last byte ever appended. */
	readonly producedOffset: number;
	/** Bytes currently retained. */
	readonly size: number;
}

interface RingState {
	capacity: number;
	produced: number;
	retained: number;
	segments: Segment[];
}

function evict(state: RingState): void {
	while (state.retained > state.capacity && state.segments.length > 0) {
		const oldest = state.segments[0];
		if (!oldest) {
			return;
		}
		// A single oversized segment is trimmed in place rather than dropped
		// whole, so capacity is a hard ceiling even for one huge write.
		const overshoot = state.retained - state.capacity;
		if (oldest.bytes.length > overshoot) {
			state.segments[0] = {
				bytes: oldest.bytes.subarray(overshoot),
				offset: oldest.offset + overshoot,
			};
			state.retained -= overshoot;
			return;
		}
		state.segments.shift();
		state.retained -= oldest.bytes.length;
	}
}

function appendChunk(state: RingState, chunk: Uint8Array): void {
	if (chunk.length === 0) {
		return;
	}
	state.segments.push({ bytes: chunk, offset: state.produced });
	state.produced += chunk.length;
	state.retained += chunk.length;
	evict(state);
}

function readFrom(state: RingState, offset: number): Uint8Array {
	const from = Math.max(offset, state.produced - state.retained);
	if (from >= state.produced) {
		return new Uint8Array(0);
	}
	const out = new Uint8Array(state.produced - from);
	for (const seg of state.segments) {
		if (seg.offset + seg.bytes.length <= from) {
			continue;
		}
		const sliceStart = Math.max(0, from - seg.offset);
		out.set(seg.bytes.subarray(sliceStart), seg.offset + sliceStart - from);
	}
	return out;
}

export function createScrollbackRing(
	capacityBytes: number = DEFAULT_SCROLLBACK_BYTES
): ScrollbackRing {
	const state: RingState = {
		capacity: capacityBytes,
		produced: 0,
		retained: 0,
		segments: [],
	};
	return {
		get producedOffset() {
			return state.produced;
		},
		get size() {
			return state.retained;
		},
		append: (chunk) => appendChunk(state, chunk),
		bytesFrom: (offset) => readFrom(state, offset),
	};
}
