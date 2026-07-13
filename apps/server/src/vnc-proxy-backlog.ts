import type { VncData } from "./vnc-proxy";

// RFB is server-speaks-first: the VNC server sends its ProtocolVersion the
// instant the CLI relay's producer connects — usually before any viewer has
// attached. Those producer→consumer bytes are buffered here and flushed when
// the consumer attaches, so the handshake doesn't deadlock (the version string
// is never re-sent). Capped so a producer with no viewer can't grow it forever.
const MAX_BACKLOG_BYTES = 512 * 1024;

export interface Backlog {
	bytes: number;
	chunks: VncData[];
}

export function newBacklog(): Backlog {
	return { bytes: 0, chunks: [] };
}

export function bufferByte(backlog: Backlog, data: VncData): void {
	if (backlog.bytes >= MAX_BACKLOG_BYTES) {
		return;
	}
	backlog.chunks.push(data);
	backlog.bytes += typeof data === "string" ? data.length : data.byteLength;
}

/** One-shot flush: sends everything buffered, then empties the backlog so a
 * replacement consumer doesn't replay it. */
export function flushBacklog(
	backlog: Backlog,
	send: (data: VncData) => void
): void {
	for (const chunk of backlog.chunks) {
		send(chunk);
	}
	backlog.chunks = [];
	backlog.bytes = 0;
}
