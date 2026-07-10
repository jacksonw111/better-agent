// Read-only noVNC viewer for a cua/computer-use bridge session. It opens a
// binary WebSocket to the server's VNC proxy route and lets a noVNC `RFB`
// instance paint the remote desktop into an attached container. Mounted later
// (Lane B) behind the cua/vnc capability; created here so it compiles standalone.

import { env } from "@better-agent/env/web";
import RFB from "@novnc/novnc/core/rfb.js";
import { useEffect, useRef, useState } from "react";

type ConnectionState = "connecting" | "connected" | "disconnected";

const HTTP_SCHEME = /^http/;

// Derive the ws(s):// viewer URL from the app's configured server base
// (VITE_SERVER_URL — the same origin the oRPC link and SSE stream use). http →
// ws, https → wss; anything else (already a ws URL) is passed through as-is.
function viewerUrl(sessionId: string): string {
	const base = env.VITE_SERVER_URL.replace(HTTP_SCHEME, "ws");
	return `${base}/bridge/vnc/viewer/${sessionId}`;
}

const STATUS_LABEL: Record<ConnectionState, string> = {
	connecting: "Connecting to desktop…",
	connected: "Connected",
	disconnected: "Disconnected",
};

export function VncViewer({ sessionId }: { sessionId: string }) {
	const screenRef = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<ConnectionState>("connecting");

	useEffect(() => {
		const screen = screenRef.current;
		if (!screen) {
			// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
			return undefined;
		}

		setState("connecting");
		const rfb = new RFB(screen, viewerUrl(sessionId));
		rfb.viewOnly = false;
		rfb.scaleViewport = true;
		rfb.background = "transparent";

		const handleConnect = () => setState("connected");
		const handleDisconnect = () => setState("disconnected");
		rfb.addEventListener("connect", handleConnect);
		rfb.addEventListener("disconnect", handleDisconnect);

		return () => {
			rfb.removeEventListener("connect", handleConnect);
			rfb.removeEventListener("disconnect", handleDisconnect);
			rfb.disconnect();
		};
	}, [sessionId]);

	const isConnected = state === "connected";

	return (
		<div className="flex flex-col gap-2">
			<div
				aria-label="Remote desktop"
				className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black"
				ref={screenRef}
				role="application"
			>
				{isConnected ? null : (
					<div className="absolute inset-0 flex items-center justify-center">
						<p className="text-muted-foreground text-sm">
							{STATUS_LABEL[state]}
						</p>
					</div>
				)}
			</div>
			<p
				aria-live="polite"
				className="text-muted-foreground text-xs"
				role="status"
			>
				{STATUS_LABEL[state]}
			</p>
		</div>
	);
}
