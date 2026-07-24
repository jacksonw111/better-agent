// P2-2 (DP-PTY6): the React shell around a native-grade PTY terminal. It owns
// ONLY the container element and the coarse lifecycle state (status, exit code)
// — everything on the byte hot path lives in startPtyTerminalSession, outside
// React. A DATA frame arriving re-renders NOTHING here; React updates only on
// connect/disconnect/exit, which happen a handful of times per session. That
// separation is the entire reason this can match a native terminal's feel.

import "@xterm/xterm/css/xterm.css";
import type { PtyOpenSpec } from "@better-agent/api/pty/frame";
import { useEffect, useRef, useState } from "react";
import {
	type PtyConnectionStatus,
	startPtyTerminalSession,
} from "./pty-terminal-session";

const STATUS_LABEL: Record<PtyConnectionStatus, string> = {
	connecting: "Connecting…",
	connected: "Connected",
	reconnecting: "Reconnecting…",
	exited: "Process exited",
	closed: "Not connected",
};

/** The small out-of-terminal footer. Never fabricates terminal content — the
 * exit code is shown here, beside the terminal, not injected into the buffer. */
function StatusFooter({
	status,
	exitCode,
}: {
	exitCode: number | null;
	status: PtyConnectionStatus;
}) {
	const isConnected = status === "connected";
	return (
		<p
			aria-live="polite"
			className="flex items-center gap-1.5 px-1 text-muted-foreground text-xs"
			role="status"
		>
			<span
				aria-hidden
				className={`inline-block size-1.5 rounded-full ${
					isConnected ? "bg-emerald-500" : "bg-muted-foreground/40"
				}`}
			/>
			{STATUS_LABEL[status]}
			{exitCode === null ? "" : ` · code ${exitCode}`}
		</p>
	);
}

/**
 * Attaches to `sessionId` on `computerId` and renders its live PTY. When
 * `active` is false the session is not connected at all (multi-session budget,
 * §4.5) — only the terminal you're looking at holds a full-speed stream;
 * re-activating reconnects and the CLI replays scrollback.
 */
export function PtyTerminal({
	active = true,
	className,
	computerId,
	sessionId,
	spec,
}: {
	active?: boolean;
	className?: string;
	computerId: string;
	sessionId: string;
	/** Spawn spec for a fresh session (from `pty.createSession`). Read at connect
	 * time via a ref so a new object identity never restarts the session — the
	 * effect only re-runs on computerId/sessionId/active. */
	spec?: PtyOpenSpec | null;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const specRef = useRef(spec);
	specRef.current = spec;
	const [status, setStatus] = useState<PtyConnectionStatus>("connecting");
	const [exitCode, setExitCode] = useState<number | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!(container && active)) {
			// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
			return undefined;
		}
		setExitCode(null);
		const session = startPtyTerminalSession({
			computerId,
			sessionId,
			container,
			onStatus: setStatus,
			onExit: setExitCode,
			spec: specRef.current,
		});
		return () => session.dispose();
	}, [computerId, sessionId, active]);

	return (
		<div className={`flex min-h-0 flex-1 flex-col gap-1.5 ${className ?? ""}`}>
			<div
				aria-label="Terminal"
				className="min-h-0 flex-1 overflow-hidden rounded-lg bg-neutral-950 p-2"
				ref={containerRef}
				role="application"
			/>
			<StatusFooter exitCode={exitCode} status={status} />
		</div>
	);
}
