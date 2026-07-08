// The claude-code adapter's `getStatus` implementation, split out of
// claude-code.ts to keep that file under the repo's 300-line limit. Answers a
// `control: getStatus` command by asking the SDK control channel for the
// current context usage + MCP server statuses and pushing ONE normalized
// `status_snapshot` event (see `StatusSnapshotDetail` in ./types.ts) — the
// same fire-and-forget "reply on the event stream" shape as `listSessions`.

import type {
	McpServerStatus,
	ModelInfo,
	SDKControlGetContextUsageResponse,
	SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import { listSessions as sdkListSessions } from "@anthropic-ai/claude-agent-sdk";
import type { NormalizedEvent } from "../normalize/types";
import { isRecord } from "../normalize/types";
import { STATUS_SNAPSHOT_STATUS, type StatusSnapshotDetail } from "./types";

/** How long each SDK control-channel call (`supportedModels`,
 * `getContextUsage`, `mcpServerStatus`) may take before its caller proceeds
 * without that piece. A safety valve so a stuck control channel can never
 * freeze the feed's first event (`session_ready` waits on the model list) or
 * leave the web's status request unanswered; in practice these resolve off
 * the same init handshake well before the timeout. */
const CONTROL_CALL_TIMEOUT_MS = 4000;

/** The two SDK control-channel methods `getStatus` reads — a structural
 * subset of the SDK `Query` so tests can hand in a plain mock. */
export interface StatusQuery {
	getContextUsage(): Promise<SDKControlGetContextUsageResponse>;
	mcpServerStatus(): Promise<McpServerStatus[]>;
}

interface EventSink {
	push(event: NormalizedEvent): void;
}

/** The adapter-tracked model/permissionMode used to fill the snapshot fields
 * the SDK has no on-demand read for: seeded off the `session_ready` init
 * event (see `recordSessionInfo`) and updated by the handle's own
 * `setModel`/`setPermissionMode` calls. */
export interface LastKnownSessionInfo {
	model?: string;
	permissionMode?: string;
}

/** Captures `session_ready`'s model/permissionMode into `lastKnown` as the
 * event flows by — a pure observer, the event itself is never altered. */
export function recordSessionInfo(
	event: NormalizedEvent,
	lastKnown: LastKnownSessionInfo
): void {
	if (
		event.kind !== "status" ||
		event.status !== "session_ready" ||
		!isRecord(event.detail)
	) {
		return;
	}
	if (typeof event.detail.model === "string") {
		lastKnown.model = event.detail.model;
	}
	if (typeof event.detail.permissionMode === "string") {
		lastKnown.permissionMode = event.detail.permissionMode;
	}
}

/** Runs one SDK control call, resolving to `undefined` (never rejecting,
 * never hanging) on any failure or timeout. `Promise.resolve().then(call)`
 * also converts a synchronous throw (e.g. the method missing entirely) into
 * the same `undefined`. */
function resolveGuarded<T>(call: () => Promise<T>): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => resolve(undefined), CONTROL_CALL_TIMEOUT_MS);
	});
	const result = Promise.resolve()
		.then(call)
		.catch(() => undefined)
		.finally(() => clearTimeout(timer));
	return Promise.race([result, timeout]);
}

/** Fetches this session's available model ids from the SDK control channel,
 * resolving to `undefined` (never rejecting, never hanging) on any failure or
 * timeout — see `resolveGuarded`. The web model picker lists exactly these
 * ids; an empty/absent list hides the picker. Lives here (not claude-code.ts)
 * purely for the shared timeout guard + that file's 300-line limit. */
export function fetchSupportedModels(session: {
	supportedModels(): Promise<ModelInfo[]>;
}): Promise<string[] | undefined> {
	return resolveGuarded(() =>
		session.supportedModels().then((infos) => infos.map((info) => info.value))
	);
}

/** Folds the agent's reported model ids into the one-time `session_ready`
 * event, leaving every other event untouched. The list comes from the SDK
 * (`supportedModels()`), not the raw init line `normalize/claude-code.ts`
 * sees, so it's merged in the adapter rather than in normalize. */
export async function withReportedModels(
	event: NormalizedEvent,
	models: Promise<string[] | undefined>
): Promise<NormalizedEvent> {
	if (event.kind !== "status" || event.status !== "session_ready") {
		return event;
	}
	const list = await models;
	if (list === undefined || list.length === 0 || !isRecord(event.detail)) {
		return event;
	}
	return {
		kind: "status",
		status: "session_ready",
		detail: { ...event.detail, models: list },
	};
}

/** Assembles the snapshot from whatever resolved: a piece that failed or
 * timed out is simply absent, never an error — the web renders what arrived. */
function buildSnapshotDetail(
	usage: SDKControlGetContextUsageResponse | undefined,
	servers: McpServerStatus[] | undefined,
	lastKnown: LastKnownSessionInfo
): StatusSnapshotDetail {
	return {
		model: usage?.model ?? lastKnown.model,
		permissionMode: lastKnown.permissionMode,
		contextUsage: usage && {
			used: usage.totalTokens,
			size: usage.maxTokens,
			pct: usage.percentage,
		},
		mcpServers: servers?.map((server) => ({
			name: server.name,
			status: server.status,
		})),
	};
}

/** Builds the `AgentHandle.getStatus` implementation: fetches context usage +
 * MCP statuses off the SDK control channel (each guarded — see
 * `resolveGuarded`) and pushes one `status_snapshot` event with whatever
 * resolved. Fire-and-forget, matching `makeListSessions`'s shape. */
export function makeClaudeGetStatus(
	session: StatusQuery,
	events: EventSink,
	lastKnown: LastKnownSessionInfo
): () => void {
	return () => {
		Promise.all([
			resolveGuarded(() => session.getContextUsage()),
			resolveGuarded(() => session.mcpServerStatus()),
		]).then(([usage, servers]) => {
			events.push({
				kind: "status",
				status: STATUS_SNAPSHOT_STATUS,
				detail: buildSnapshotDetail(usage, servers, lastKnown),
			});
		});
	};
}

/** One entry the "Past conversations" picker renders — see
 * `session_ready`'s sibling status event, `session_list`, pushed by
 * `makeListSessions` below. Lives here (not claude-code.ts) for the same
 * 300-line-limit reason as the rest of this file. */
interface SessionListItem {
	cwd?: string;
	gitBranch?: string;
	id: string;
	lastModified: number;
	title: string;
}

/** `title` prefers the user's own `/rename`d title, falling back to the
 * SDK's already-curated `summary` (itself custom title, AI summary, or first
 * prompt — see `SDKSessionInfo.summary`'s doc). `cwd` lets the web build an
 * accurate `--dir` for the resume hint even if this conversation started in a
 * different directory than the one the CLI is running in right now. */
function toSessionListItem(info: SDKSessionInfo): SessionListItem {
	return {
		id: info.sessionId,
		title: info.customTitle ?? info.summary,
		lastModified: info.lastModified,
		gitBranch: info.gitBranch,
		cwd: info.cwd,
	};
}

/** Builds the `AgentHandle.listSessions` implementation: fetches this
 * project directory's past claude conversations and pushes them as a
 * `session_list` status event — fire-and-forget (the SDK call is async, but
 * the handle's method itself isn't), matching `makeClaudeGetStatus`'s shape.
 * A lookup failure becomes an error event rather than an unhandled
 * rejection. */
export function makeListSessions(dir: string, events: EventSink): () => void {
	return () => {
		sdkListSessions({ dir })
			.then((sessions) => {
				events.push({
					kind: "status",
					status: "session_list",
					detail: { sessions: sessions.map(toSessionListItem) },
				});
			})
			.catch((error: unknown) => {
				events.push({
					kind: "error",
					message: "Failed to list past claude sessions",
					detail: error instanceof Error ? error.message : String(error),
				});
			});
	};
}
