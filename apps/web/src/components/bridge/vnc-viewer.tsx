// noVNC viewer for a cua/computer-use bridge session. Owns a binary WebSocket
// to the server's VNC proxy route (bearer passed via ?access_token= — browsers
// can't set WS headers) and hands it to a noVNC `RFB` instance to paint the
// remote desktop. We own the socket (rather than passing a URL) so we can read
// the exact close code/reason — noVNC's 'disconnect' event hides it — and show
// it, which is the difference between "auth rejected" and "transient drop". The
// RFB credentials (if the VM/host requires them) are prompted for here; the
// relay is byte-transparent, so auth negotiates end-to-end with the VNC server.

import { env } from "@better-agent/env/web";
import { Button } from "@better-agent/ui/components/button";
import RFB from "@novnc/novnc";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "@/utils/auth";

type ConnectionState = "connecting" | "connected" | "disconnected";

interface Credentials {
	password?: string;
	username?: string;
}

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

/** Opens the viewer WebSocket and reports its close code/reason via `onClose`
 * (a 1008 means the server rejected auth; 1005/1006 is an abnormal/relay drop). */
function openViewerSocket(
	sessionId: string,
	onClose: (info: string) => void
): WebSocket {
	const socket = new WebSocket(viewerUrl(sessionId));
	socket.binaryType = "arraybuffer";
	socket.addEventListener("close", (event) => {
		const reason = event.reason ? ` · ${event.reason}` : "";
		onClose(`socket closed (code ${event.code}${reason})`);
	});
	return socket;
}

interface VncCallbacks {
	setCredentialTypes: (types: string[] | null) => void;
	setDetail: (detail: string | null) => void;
	setState: (state: ConnectionState) => void;
}

// noVNC tells us which credentials the server's security type needs — VNC auth
// wants ['password']; Apple/ARD (macOS Screen Sharing) wants ['username',
// 'password']. Honor it, or auth silently stalls (noVNC sends nothing until it
// has every field it asked for).
function rfbListeners(cb: VncCallbacks): [string, EventListener][] {
	return [
		[
			"connect",
			() => {
				cb.setState("connected");
				cb.setDetail(null);
			},
		],
		["disconnect", () => cb.setState("disconnected")],
		[
			"credentialsrequired",
			(event) => {
				const types = (event as CustomEvent<{ types?: string[] }>).detail
					?.types;
				cb.setCredentialTypes(types ?? ["password"]);
			},
		],
		[
			"securityfailure",
			(event) => {
				const reason = (event as CustomEvent<{ reason?: string }>).detail
					?.reason;
				cb.setDetail(reason ? `auth failed: ${reason}` : "auth failed");
				cb.setState("disconnected");
			},
		],
	];
}

function connectRfb(
	screen: HTMLDivElement,
	sessionId: string,
	cb: VncCallbacks
): { rfb: RFB; dispose: () => void } {
	const socket = openViewerSocket(sessionId, cb.setDetail);
	const rfb = new RFB(screen, socket);
	rfb.viewOnly = false;
	rfb.scaleViewport = true;
	rfb.background = "transparent";
	const listeners = rfbListeners(cb);
	for (const [type, fn] of listeners) {
		rfb.addEventListener(type, fn);
	}
	return {
		rfb,
		dispose: () => {
			for (const [type, fn] of listeners) {
				rfb.removeEventListener(type, fn);
			}
			rfb.disconnect();
		},
	};
}

function useVncConnection(sessionId: string) {
	const screenRef = useRef<HTMLDivElement>(null);
	const rfbRef = useRef<RFB | null>(null);
	const [state, setState] = useState<ConnectionState>("connecting");
	// null = no prompt; otherwise the credential fields noVNC asked for.
	const [credentialTypes, setCredentialTypes] = useState<string[] | null>(null);
	// Human-readable reason for the last failure, surfaced for diagnosis.
	const [detail, setDetail] = useState<string | null>(null);

	useEffect(() => {
		const screen = screenRef.current;
		if (!screen) {
			// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
			return undefined;
		}
		setState("connecting");
		setCredentialTypes(null);
		setDetail(null);
		const { rfb, dispose } = connectRfb(screen, sessionId, {
			setState,
			setCredentialTypes,
			setDetail,
		});
		rfbRef.current = rfb;
		return () => {
			rfbRef.current = null;
			dispose();
		};
	}, [sessionId]);

	const submitCredentials = useCallback((credentials: Credentials) => {
		rfbRef.current?.sendCredentials(credentials);
		setCredentialTypes(null);
		setState("connecting");
	}, []);

	return { screenRef, state, credentialTypes, submitCredentials, detail };
}

function CredentialField({
	label,
	type,
	value,
	onChange,
}: {
	label: string;
	type: "text" | "password";
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<input
			aria-label={label}
			autoComplete={type === "password" ? "current-password" : "username"}
			className="w-48 rounded-md border bg-background px-2 py-1 text-sm"
			onChange={(event) => onChange(event.target.value)}
			placeholder={label}
			type={type}
			value={value}
		/>
	);
}

function CredentialsOverlay({
	types,
	onSubmit,
}: {
	types: string[];
	onSubmit: (credentials: Credentials) => void;
}) {
	const needsUsername = types.includes("username");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const canSubmit =
		password.length > 0 && (!needsUsername || username.length > 0);
	return (
		<form
			className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (canSubmit) {
					onSubmit(needsUsername ? { username, password } : { password });
				}
			}}
		>
			<span className="text-sm text-white">
				{needsUsername ? "Mac username & password" : "VNC password"}
			</span>
			{needsUsername ? (
				<CredentialField
					label="Username"
					onChange={setUsername}
					type="text"
					value={username}
				/>
			) : null}
			<CredentialField
				label="Password"
				onChange={setPassword}
				type="password"
				value={password}
			/>
			<Button disabled={!canSubmit} size="sm" type="submit">
				Connect
			</Button>
		</form>
	);
}

export function VncViewer({ sessionId }: { sessionId: string }) {
	const { screenRef, state, credentialTypes, submitCredentials, detail } =
		useVncConnection(sessionId);
	const isConnected = state === "connected";
	const needsCredentials = credentialTypes !== null;
	return (
		<div className="flex flex-col gap-2">
			<div
				aria-label="Remote desktop"
				className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black"
				ref={screenRef}
				role="application"
			>
				{needsCredentials ? (
					<CredentialsOverlay
						onSubmit={submitCredentials}
						types={credentialTypes}
					/>
				) : null}
				{isConnected || needsCredentials ? null : (
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
				{detail ? ` — ${detail}` : ""}
			</p>
		</div>
	);
}
