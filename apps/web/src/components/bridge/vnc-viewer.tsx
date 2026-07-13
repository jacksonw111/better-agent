// Read-only-ish noVNC viewer for a cua/computer-use bridge session. Opens a
// binary WebSocket to the server's VNC proxy route (bearer passed via
// ?access_token= — browsers can't set WS headers) and lets a noVNC `RFB`
// instance paint the remote desktop. The RFB VNC password (if the VM/host
// requires one) is prompted for here — the relay is byte-transparent, so auth
// negotiates end-to-end between noVNC and the VNC server.

import { env } from "@better-agent/env/web";
import { Button } from "@better-agent/ui/components/button";
import RFB from "@novnc/novnc";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "@/utils/auth";

type ConnectionState = "connecting" | "connected" | "disconnected";

const HTTP_SCHEME = /^http/;

function viewerUrl(sessionId: string): string {
	const base = env.VITE_SERVER_URL.replace(HTTP_SCHEME, "ws");
	const token = getAccessToken();
	const query = token ? `?access_token=${encodeURIComponent(token)}` : "";
	return `${base}/bridge/vnc/viewer/${sessionId}${query}`;
}

const STATUS_LABEL: Record<ConnectionState, string> = {
	connecting: "Connecting to desktop…",
	connected: "Connected",
	disconnected: "Disconnected",
};

function useVncConnection(sessionId: string) {
	const screenRef = useRef<HTMLDivElement>(null);
	const rfbRef = useRef<RFB | null>(null);
	const [state, setState] = useState<ConnectionState>("connecting");
	const [needsPassword, setNeedsPassword] = useState(false);

	useEffect(() => {
		const screen = screenRef.current;
		if (!screen) {
			// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
			return undefined;
		}
		setState("connecting");
		setNeedsPassword(false);
		const rfb = new RFB(screen, viewerUrl(sessionId));
		rfbRef.current = rfb;
		rfb.viewOnly = false;
		rfb.scaleViewport = true;
		rfb.background = "transparent";
		const onConnect = () => setState("connected");
		const onDisconnect = () => setState("disconnected");
		const onCreds = () => setNeedsPassword(true);
		rfb.addEventListener("connect", onConnect);
		rfb.addEventListener("disconnect", onDisconnect);
		rfb.addEventListener("credentialsrequired", onCreds);
		rfb.addEventListener("securityfailure", onDisconnect);
		return () => {
			rfb.removeEventListener("connect", onConnect);
			rfb.removeEventListener("disconnect", onDisconnect);
			rfb.removeEventListener("credentialsrequired", onCreds);
			rfb.removeEventListener("securityfailure", onDisconnect);
			rfbRef.current = null;
			rfb.disconnect();
		};
	}, [sessionId]);

	const submitPassword = useCallback((password: string) => {
		rfbRef.current?.sendCredentials({ password });
		setNeedsPassword(false);
		setState("connecting");
	}, []);

	return { screenRef, state, needsPassword, submitPassword };
}

function PasswordOverlay({
	onSubmit,
}: {
	onSubmit: (password: string) => void;
}) {
	const [password, setPassword] = useState("");
	return (
		<form
			className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (password) {
					onSubmit(password);
				}
			}}
		>
			<span className="text-sm text-white">VNC password</span>
			<input
				className="w-48 rounded-md border bg-background px-2 py-1 text-sm"
				onChange={(event) => setPassword(event.target.value)}
				type="password"
				value={password}
			/>
			<Button disabled={!password} size="sm" type="submit">
				Connect
			</Button>
		</form>
	);
}

export function VncViewer({ sessionId }: { sessionId: string }) {
	const { screenRef, state, needsPassword, submitPassword } =
		useVncConnection(sessionId);
	const isConnected = state === "connected";
	return (
		<div className="flex flex-col gap-2">
			<div
				aria-label="Remote desktop"
				className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black"
				ref={screenRef}
				role="application"
			>
				{needsPassword ? <PasswordOverlay onSubmit={submitPassword} /> : null}
				{isConnected || needsPassword ? null : (
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
