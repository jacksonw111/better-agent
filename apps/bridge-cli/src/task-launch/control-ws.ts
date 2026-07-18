import { signComputerRequest } from "@better-agent/agent/crypto/computer-signature";
import type {
	ProjectCloneCommand,
	ProjectQueryCommand,
} from "@better-agent/agent/project-ports";
import type { RunLaunchCommand } from "@better-agent/agent/task-ports";
import type { ComputerSigningIdentity } from "../computer-transport";
import { createMonotonicTimestamp } from "../computer-transport";
import { isRecord } from "../normalize/types";
import { reconnectDelayMs } from "../ws-duplex-backoff";
import {
	defaultWsFactory,
	type WsFactory,
	type WsLike,
} from "../ws-duplex-socket";

// S25-T1 (design D4): the client half of the computer control channel — a
// `GET /computer-ws` connection authenticated by the SAME Ed25519 scheme as
// the x-ba-* header plane, carried in query params (a WS upgrade can't set
// custom headers; see apps/server/src/computer-ws.ts). The server pushes one
// JSON command per frame — launch, clone_project or (Q2) a real-time
// project_query; acks/answers travel over oRPC (runs.ackLaunch,
// projects.ackClone, projects.submitQueryResult), never this socket. The channel is best-effort BY DESIGN: heartbeat
// `pendingCommands` is the delivery guarantee, so this loop just reconnects
// with the shared exponential backoff schedule forever — a downed channel
// degrades to ≤10s launch latency, never to a crash.

const TRAILING_SLASH = /\/$/;
// http(s):// → ws(s):// — same one-step replace as relay-transport.ts.
const HTTP_SCHEME_PREFIX = /^http/;

export interface ControlChannelConfig {
	identity: ComputerSigningIdentity;
	log?: (message: string) => void;
	/** Strictly-increasing timestamp source. Share ONE with the HTTP
	 * transport (see index.ts) so the server's per-computer replay guard —
	 * which spans both planes — never sees the two racing backwards. */
	nextTimestamp?: () => number;
	/** Q2: clone_project frames. Optional — without a handler the frame is
	 * ignored and the command simply stays queued for heartbeat delivery. */
	onCloneProject?: (command: ProjectCloneCommand) => void;
	onLaunch(command: RunLaunchCommand): void;
	/** Q2: real-time project_query frames — WS-only by design (never part of
	 * pendingCommands), so ignoring one just times out server-side. */
	onProjectQuery?: (command: ProjectQueryCommand) => void;
	serverUrl: string;
	signal: AbortSignal;
	sleep?: (ms: number) => Promise<void>;
	wsFactory?: WsFactory;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The signed handshake URL — a FRESH timestamp + signature per attempt,
 * because the replay guard rejects any non-advancing timestamp. */
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

/** Every frame kind the server pushes down /computer-ws (Q2). */
export type ComputerControlFrame =
	| RunLaunchCommand
	| ProjectCloneCommand
	| ProjectQueryCommand;

function isLaunchFrame(parsed: Record<string, unknown>): boolean {
	return (
		typeof parsed.runId === "string" &&
		typeof parsed.taskId === "string" &&
		typeof parsed.sessionCredential === "string"
	);
}

function isCloneFrame(parsed: Record<string, unknown>): boolean {
	return (
		typeof parsed.projectId === "string" &&
		typeof parsed.repoCloneUrl === "string"
	);
}

function isQueryFrame(parsed: Record<string, unknown>): boolean {
	return (
		typeof parsed.requestId === "string" &&
		typeof parsed.projectId === "string" &&
		(parsed.op === "fs_list" || parsed.op === "git_status")
	);
}

/** Parses one pushed frame into a control command, or null for anything else
 * (the channel ignores unknown frames instead of dying on them). */
export function parseControlFrame(data: unknown): ComputerControlFrame | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(String(data));
	} catch {
		return null;
	}
	if (!isRecord(parsed)) {
		return null;
	}
	const valid =
		(parsed.kind === "launch" && isLaunchFrame(parsed)) ||
		(parsed.kind === "clone_project" && isCloneFrame(parsed)) ||
		(parsed.kind === "project_query" && isQueryFrame(parsed));
	return valid ? (parsed as unknown as ComputerControlFrame) : null;
}

/** Routes one parsed frame to its (possibly absent) handler. */
function dispatchFrame(
	config: ControlChannelConfig,
	frame: ComputerControlFrame
): void {
	switch (frame.kind) {
		case "launch":
			config.onLaunch(frame);
			return;
		case "clone_project":
			config.onCloneProject?.(frame);
			return;
		default:
			config.onProjectQuery?.(frame);
	}
}

/** One connection's lifetime: resolves `{ opened }` when the socket drops
 * (or the signal aborts), never rejects. */
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
		socket.on("message", (data) => {
			const frame = parseControlFrame(data);
			if (frame) {
				dispatchFrame(config, frame);
			}
		});
		socket.on("close", finish);
		socket.on("error", finish);
		config.signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Runs the control channel until `signal` aborts: connect, listen for launch
 * frames, and on any drop wait the backoff delay (reset by a successful
 * open) before reconnecting with a fresh signed URL.
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
