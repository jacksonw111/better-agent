// P2-2 (DP-PTY6): the imperative lifecycle of one attached PTY terminal —
// deliberately OUTSIDE React. It owns the xterm `Terminal` (created once), its
// WebGL renderer + fit addon, the viewer WebSocket (with backoff reconnect),
// and the byte driver. React (pty-terminal.tsx) only mounts a container and
// reads status/exit through the callbacks here; no PTY byte ever crosses back
// into the render loop. Keeping this a plain function (not a hook) is what lets
// the "data arrival → term.write, never React" invariant be true by construction
// and lets the whole path be driven by a fake Terminal + fake WebSocket in tests.

import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import {
	createPtyTerminalDriver,
	type PtyTerminalDriver,
} from "./pty-terminal-driver";
import { ptyViewerUrl, reconnectDelayMs } from "./viewer-url";

// Bounded scrollback (DP-PTY6): xterm's own ring caps tab memory regardless of
// how many bytes stream through — we NEVER keep a growing array in JS.
const SCROLLBACK_LINES = 10_000;

export type PtyConnectionStatus =
	| "connecting"
	| "connected"
	| "reconnecting"
	| "exited"
	| "closed";

export interface PtyTerminalSessionOptions {
	computerId: string;
	container: HTMLElement;
	onExit: (exitCode: number) => void;
	onStatus: (status: PtyConnectionStatus) => void;
	sessionId: string;
}

export interface PtyTerminalSession {
	dispose(): void;
}

const TERMINAL_THEME = {
	background: "#0a0a0a",
	foreground: "#e4e4e7",
} as const;

function createTerminal(container: HTMLElement): {
	fit: FitAddon;
	term: Terminal;
} {
	const term = new Terminal({
		allowProposedApi: true,
		cursorBlink: true,
		fontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
		fontSize: 13,
		scrollback: SCROLLBACK_LINES,
		theme: TERMINAL_THEME,
	});
	const fit = new FitAddon();
	term.loadAddon(fit);
	term.open(container);
	// WebGL is the whole point (GPU-accelerated, VS Code-grade); fall back to the
	// default DOM renderer if the context can't be created (headless/old GPU).
	try {
		const webgl = new WebglAddon();
		webgl.onContextLoss(() => webgl.dispose());
		term.loadAddon(webgl);
	} catch {
		// DOM renderer stays active; no action needed.
	}
	fit.fit();
	return { term, fit };
}

// The mutable state one attached session threads through connect/reconnect.
// A plain object (not React state) shared by the module-scope helpers below.
interface SessionRuntime {
	attempt: number;
	computerId: string;
	disposed: boolean;
	driver: PtyTerminalDriver;
	exited: boolean;
	fit: FitAddon;
	onStatus: (status: PtyConnectionStatus) => void;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
	term: Terminal;
	ws: WebSocket | null;
}

function scheduleReconnect(rt: SessionRuntime): void {
	const delay = reconnectDelayMs(rt.attempt);
	rt.attempt += 1;
	rt.reconnectTimer = setTimeout(() => {
		rt.reconnectTimer = null;
		connect(rt);
	}, delay);
}

/** Opens one viewer socket and wires its lifecycle; a drop (not an exit)
 * schedules a backoff reconnect that resends OPEN so the CLI resumes replay. */
function connect(rt: SessionRuntime): void {
	if (rt.disposed || rt.exited) {
		return;
	}
	const url = ptyViewerUrl(rt.computerId);
	if (!url) {
		rt.onStatus("closed");
		return;
	}
	const socket = new WebSocket(url);
	socket.binaryType = "arraybuffer";
	rt.ws = socket;
	socket.onopen = () => {
		rt.attempt = 0;
		rt.onStatus("connected");
		rt.fit.fit();
		// OPEN = attach: the CLI replays scrollback from our ACK cursor as a bulk
		// DATA burst, then goes live (DP-PTY3 reattach).
		rt.driver.open(rt.term.cols, rt.term.rows);
	};
	socket.onmessage = (event) => {
		// HOT PATH — bytes go straight to the driver → term.write; no React.
		if (event.data instanceof ArrayBuffer) {
			rt.driver.handleFrame(new Uint8Array(event.data));
		}
	};
	socket.onclose = () => {
		rt.ws = null;
		if (!(rt.disposed || rt.exited)) {
			rt.onStatus("reconnecting");
			scheduleReconnect(rt);
		}
	};
	// A failed handshake still fires `close`; let that path reconnect.
	socket.onerror = () => socket.close();
}

/** Attaches to `sessionId` on `computerId`, streaming its bytes into a fresh
 * xterm terminal mounted in `container`. Returns a `dispose` that tears the
 * whole thing down (socket, terminal, observers, timers). */
/** Created ONCE per session, sending through whatever socket is live (stable
 * closure over `rt.ws`) so its flow-control cursor survives a reconnect. */
function createSessionDriver(
	rt: SessionRuntime,
	sessionId: string,
	onExit: (exitCode: number) => void
): PtyTerminalDriver {
	return createPtyTerminalDriver({
		sessionId,
		term: rt.term,
		// Always plain ArrayBuffer-backed (never SharedArrayBuffer); the cast
		// satisfies WebSocket.send's BufferSource.
		socket: { send: (frame) => rt.ws?.send(frame as Uint8Array<ArrayBuffer>) },
		onExit: (code) => {
			rt.exited = true;
			rt.onStatus("exited");
			onExit(code);
		},
	});
}

/** Fit-on-resize: refit the terminal to its container and, when the grid size
 * actually changed, tell the CLI (→ SIGWINCH). */
function attachResizeObserver(rt: SessionRuntime): ResizeObserver {
	let lastCols = rt.term.cols;
	let lastRows = rt.term.rows;
	const observer = new ResizeObserver(() => {
		if (rt.disposed) {
			return;
		}
		rt.fit.fit();
		if (rt.term.cols !== lastCols || rt.term.rows !== lastRows) {
			lastCols = rt.term.cols;
			lastRows = rt.term.rows;
			rt.driver.resize(rt.term.rows, rt.term.cols);
		}
	});
	return observer;
}

export function startPtyTerminalSession(
	options: PtyTerminalSessionOptions
): PtyTerminalSession {
	const { computerId, sessionId, container, onStatus, onExit } = options;
	const { term, fit } = createTerminal(container);
	const rt: SessionRuntime = {
		attempt: 0,
		computerId,
		disposed: false,
		exited: false,
		fit,
		onStatus,
		reconnectTimer: null,
		term,
		ws: null,
		driver: undefined as unknown as PtyTerminalDriver,
	};
	rt.driver = createSessionDriver(rt, sessionId, onExit);
	const resizeObserver = attachResizeObserver(rt);
	resizeObserver.observe(container);

	onStatus("connecting");
	connect(rt);

	return {
		dispose: () => {
			rt.disposed = true;
			if (rt.reconnectTimer !== null) {
				clearTimeout(rt.reconnectTimer);
			}
			resizeObserver.disconnect();
			rt.driver.dispose();
			rt.ws?.close();
			rt.ws = null;
			term.dispose();
		},
	};
}
