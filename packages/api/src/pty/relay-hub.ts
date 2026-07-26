// Server-side PTY relay (Slice P2-1, DP-PTY2). A PURE byte relay: it reads only
// each frame's 1-byte type + 16-byte sessionId header to route, never the DATA
// payload, and never persists anything. One CLI daemon per computer holds the
// "agent" socket; web "viewer" sockets attach to sessions on that computer. The
// hub forwards viewer→agent frames straight through, and fans agent→viewer
// frames out only to the viewers subscribed (via OPEN) to that frame's session.
//
// Deliberately in-process, like CommandBus / the computer control channel: an
// agent socket and the viewer sockets for its computer always live on the same
// Node process (single-instance topology). Auth (computer signature for the
// agent, bearer-token ownership for viewers) is enforced at the WS wiring layer
// (apps/server/src/pty-ws.ts) before a connection is ever handed to the hub.

import {
	decodeLivenessSessionIds,
	PtyFrameType,
	peekSessionId,
	peekType,
} from "./frame";

/** The one thing the hub needs from a live WS: send a binary frame. */
export interface PtyRelaySocket {
	send(frame: Uint8Array): void;
}

/** A registered connection — the WS wiring drives `handleFrame` on each inbound
 * binary message and `close` when the socket drops. */
export interface PtyRelayConnection {
	close(): void;
	handleFrame(frame: Uint8Array): void;
}

/** Server-side reactions to the CLI's out-of-band control frames (P25-A). The
 * hub relays raw pty bytes but intercepts these — they never reach a viewer.
 * The WS wiring (pty-ws.ts) supplies handlers that touch the session registry. */
export interface PtyAgentControlHandlers {
	/** One session produced output / was attached → bump its last-activity. */
	onActivity?(computerId: string, sessionId: string): void;
	/** The CLI's held-session list on (re)connect → reconcile zombies. */
	onLiveness?(computerId: string, sessionIds: string[]): void;
}

interface ViewerState {
	sessions: Set<string>;
	socket: PtyRelaySocket;
}

export interface PtyRelayHub {
	/** The CLI daemon's socket for one computer (replaces any previous).
	 * `handlers` intercept the CLI's control frames (ACTIVITY/LIVENESS). */
	connectAgent(
		computerId: string,
		socket: PtyRelaySocket,
		handlers?: PtyAgentControlHandlers
	): PtyRelayConnection;
	/** A web viewer's socket, scoped to the computer it is authorized to view. */
	connectViewer(computerId: string, socket: PtyRelaySocket): PtyRelayConnection;
	/** Push a server-originated frame to a computer's CLI (e.g. endSession's
	 * KILL). No-op when that computer's agent WS is not connected. */
	sendToAgent(computerId: string, frame: Uint8Array): void;
	/** Live viewer count for a computer (diagnostics/tests). */
	viewerCount(computerId: string): number;
}

interface HubState {
	agents: Map<string, PtyRelaySocket>;
	viewers: Map<string, Set<ViewerState>>;
}

function viewersOf(state: HubState, computerId: string): Set<ViewerState> {
	let set = state.viewers.get(computerId);
	if (!set) {
		set = new Set();
		state.viewers.set(computerId, set);
	}
	return set;
}

function fanOutToViewers(
	state: HubState,
	computerId: string,
	frame: Uint8Array
): void {
	const sessionId = peekSessionId(frame);
	const set = sessionId === null ? undefined : state.viewers.get(computerId);
	if (!(set && sessionId)) {
		return;
	}
	for (const viewer of set) {
		if (viewer.sessions.has(sessionId)) {
			viewer.socket.send(frame);
		}
	}
}

function trackViewerSubscription(viewer: ViewerState, frame: Uint8Array): void {
	const sessionId = peekSessionId(frame);
	if (sessionId === null) {
		return;
	}
	const type = peekType(frame);
	if (type === PtyFrameType.OPEN) {
		viewer.sessions.add(sessionId);
	} else if (type === PtyFrameType.CLOSE) {
		viewer.sessions.delete(sessionId);
	}
}

// The CLI's out-of-band control frames (ACTIVITY/LIVENESS) are consumed by the
// server, never forwarded to a viewer. Returns true when the frame was one.
function handleAgentControlFrame(
	computerId: string,
	frame: Uint8Array,
	handlers: PtyAgentControlHandlers | undefined
): boolean {
	const type = peekType(frame);
	if (type === PtyFrameType.ACTIVITY) {
		const sessionId = peekSessionId(frame);
		if (sessionId) {
			handlers?.onActivity?.(computerId, sessionId);
		}
		return true;
	}
	if (type === PtyFrameType.LIVENESS) {
		handlers?.onLiveness?.(computerId, decodeLivenessSessionIds(frame));
		return true;
	}
	return false;
}

function connectAgent(
	state: HubState,
	computerId: string,
	socket: PtyRelaySocket,
	handlers?: PtyAgentControlHandlers
): PtyRelayConnection {
	state.agents.set(computerId, socket);
	return {
		handleFrame: (frame) => {
			if (handleAgentControlFrame(computerId, frame, handlers)) {
				return;
			}
			fanOutToViewers(state, computerId, frame);
		},
		close: () => {
			if (state.agents.get(computerId) === socket) {
				state.agents.delete(computerId);
			}
		},
	};
}

function connectViewer(
	state: HubState,
	computerId: string,
	socket: PtyRelaySocket
): PtyRelayConnection {
	const viewer: ViewerState = { sessions: new Set(), socket };
	viewersOf(state, computerId).add(viewer);
	return {
		handleFrame: (frame) => {
			trackViewerSubscription(viewer, frame);
			state.agents.get(computerId)?.send(frame);
		},
		close: () => {
			state.viewers.get(computerId)?.delete(viewer);
		},
	};
}

export function createPtyRelayHub(): PtyRelayHub {
	const state: HubState = { agents: new Map(), viewers: new Map() };
	return {
		viewerCount: (computerId) => state.viewers.get(computerId)?.size ?? 0,
		connectAgent: (computerId, socket, handlers) =>
			connectAgent(state, computerId, socket, handlers),
		connectViewer: (computerId, socket) =>
			connectViewer(state, computerId, socket),
		sendToAgent: (computerId, frame) => {
			state.agents.get(computerId)?.send(frame);
		},
	};
}
