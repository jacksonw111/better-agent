import { signComputerRequest } from "@better-agent/agent/crypto/computer-signature";
import type {
	ProjectQueryCommand,
	WorkspaceQueryCommand,
} from "@better-agent/agent/project-ports";
import type { ComputerSigningIdentity } from "../computer-transport";
import { createMonotonicTimestamp } from "../computer-transport";
import { reconnectDelayMs } from "../ws-duplex-backoff";
import {
	defaultWsFactory,
	type WsFactory,
	type WsLike,
} from "../ws-duplex-socket";

// DP-WS: the client half of the computer control channel — a `GET /computer-ws`
// connection authenticated by the SAME Ed25519 scheme as the x-ba-* header
// plane, carried in query params (a WS upgrade can't set headers; see
// apps/server/src/computer-ws.ts). The server pushes one JSON frame per command;
// this loop cares only about the REAL-TIME query frames — `project_query`
// (projects.query) and `workspace_query` (pty.query) — which are WS-only by
// design (never in the heartbeat pendingCommands queue), so ignoring one just
// times out server-side. Launch/clone frames also arrive here but are delivered
// (and idempotently processed) through the heartbeat, so this loop ignores them.
// Answers travel over oRPC (projects.submitQueryResult), never this socket. The
// channel is best-effort: it just reconnects with the shared exponential backoff
// forever — a downed channel means queries fail fast, never a crash.

const TRAILING_SLASH = /\/$/;
const HTTP_SCHEME_PREFIX = /^http/;

export interface ControlChannelConfig {
	identity: ComputerSigningIdentity;
	log?: (message: string) => void;
	/** Strictly-increasing timestamp source shared with the HTTP transport (see
	 * index.ts) so the server's per-computer replay guard never sees the planes
	 * race backwards. */
	nextTimestamp?: () => number;
	/** Q2: real-time project_query frames (projects.query). */
	onProjectQuery?: (command: ProjectQueryCommand) => void;
	/** DP-WS: real-time workspace_query frames (pty.query). */
	onWorkspaceQuery?: (command: WorkspaceQueryCommand) => void;
	serverUrl: string;
	signal: AbortSignal;
	sleep?: (ms: number) => Promise<void>;
	wsFactory?: WsFactory;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The signed handshake URL — a FRESH timestamp + signature per attempt, since
 * the replay guard rejects any non-advancing timestamp. */
function controlWsUrl(
	config: ControlChannelConfig,
	nextTimestamp: () => number
): string {
	const base = config.serverUrl
		.replace(TRAILING_SLASH, "")
		.replace(HTTP_SCHEME_PREFIX, "ws");
	const timestampMs = nextTimestamp();
	const query = new URLSearchParams({
		computerId: config.identity.computerId,
		sig: signComputerRequest(
			config.identity.privateKeyPem,
			config.identity.computerId,
			timestampMs
		),
		ts: String(timestampMs),
	});
	return `${base}/computer-ws?${query.toString()}`;
}

function isProjectQuery(parsed: Record<string, unknown>): boolean {
	return (
		typeof parsed.requestId === "string" &&
		typeof parsed.projectId === "string" &&
		(parsed.op === "fs_list" || parsed.op === "git_status")
	);
}

function isWorkspaceQuery(parsed: Record<string, unknown>): boolean {
	return (
		typeof parsed.requestId === "string" &&
		typeof parsed.workspaceRoot === "string" &&
		(parsed.op === "fs_list" ||
			parsed.op === "git_status" ||
			parsed.op === "shell")
	);
}

/** Routes one pushed frame to its (possibly absent) query handler; any other
 * frame (launch, clone_project, unknown) is ignored — the channel never dies on
 * a frame it doesn't handle. */
export function dispatchControlFrame(
	config: ControlChannelConfig,
	data: unknown
): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(String(data));
	} catch {
		return;
	}
	if (!isRecord(parsed)) {
		return;
	}
	if (parsed.kind === "project_query" && isProjectQuery(parsed)) {
		config.onProjectQuery?.(parsed as unknown as ProjectQueryCommand);
		return;
	}
	if (parsed.kind === "workspace_query" && isWorkspaceQuery(parsed)) {
		config.onWorkspaceQuery?.(parsed as unknown as WorkspaceQueryCommand);
	}
}

/** One connection's lifetime: resolves `{ opened }` when the socket drops (or
 * the signal aborts), never rejects. */
function connectOnce(
	config: ControlChannelConfig,
	nextTimestamp: () => number,
	wsFactory: WsFactory
): Promise<{ opened: boolean }> {
	return new Promise((resolve) => {
		const socket: WsLike = wsFactory(controlWsUrl(config, nextTimestamp), {});
		let opened = false;
		let settled = false;
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			config.signal.removeEventListener("abort", onAbort);
			resolve({ opened });
		};
		const onAbort = () => {
			socket.close();
			finish();
		};
		socket.on("open", () => {
			opened = true;
		});
		socket.on("message", (data) => dispatchControlFrame(config, data));
		socket.on("close", finish);
		socket.on("error", finish);
		config.signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Runs the control channel until `signal` aborts: connect, dispatch query
 * frames, and on any drop wait the backoff delay (reset by a successful open)
 * before reconnecting with a fresh signed URL.
 */
export async function runControlChannel(
	config: ControlChannelConfig
): Promise<void> {
	const nextTimestamp = config.nextTimestamp ?? createMonotonicTimestamp();
	const wsFactory = config.wsFactory ?? defaultWsFactory;
	const sleep = config.sleep ?? defaultSleep;
	let failedAttempts = 0;
	while (!config.signal.aborted) {
		const { opened } = await connectOnce(config, nextTimestamp, wsFactory);
		if (config.signal.aborted) {
			return;
		}
		failedAttempts = opened ? 0 : failedAttempts + 1;
		config.log?.(
			`computer control channel down — reconnecting (attempt ${failedAttempts + 1})`
		);
		await sleep(reconnectDelayMs(opened ? 0 : failedAttempts - 1));
	}
}
