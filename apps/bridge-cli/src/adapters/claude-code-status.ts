// The claude-code adapter's `getStatus` implementation, split out of
// claude-code.ts to keep that file under the repo's 300-line limit. Answers a
// `control: getStatus` command by asking the SDK control channel for the
// current context usage + MCP server statuses and pushing ONE normalized
// `status_snapshot` event (see `StatusSnapshotDetail` in ./types.ts) — the
// same fire-and-forget "reply on the event stream" shape as `listSessions`.

import type {
	McpServerStatus,
	PermissionMode,
	SDKControlGetContextUsageResponse,
	SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import { listSessions as sdkListSessions } from "@anthropic-ai/claude-agent-sdk";
import type { NormalizedEvent } from "../normalize/types";
import { isRecord } from "../normalize/types";
import { isPermissionMode } from "./claude-code-startup-config";
import { fetchClaudeQuota } from "./quota/claude-quota";
import { createQuotaCache, type QuotaCache } from "./quota/quota-cache";
import { withTimeout } from "./quota/quota-shared";
import type { AgentHandle } from "./types";
import {
	type QuotaSnapshot,
	STATUS_SNAPSHOT_STATUS,
	type StatusSnapshotDetail,
} from "./types";

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

/** Statuses whose detail carries a live model/permissionMode worth folding
 * into `lastKnown`: the one-time init handshake plus the mid-session change
 * events (the handle's own read-backs AND the SDK's system/status pushes —
 * see `permissionModeChangedEvent` below and normalize/claude-code.ts's
 * `statusChangedEvent`). */
const SESSION_INFO_STATUSES = new Set([
	"session_ready",
	"model_changed",
	"permission_mode_changed",
]);

/** Captures the latest reported model/permissionMode into `lastKnown` as the
 * events flow by — a pure observer, the events themselves are never altered. */
export function recordSessionInfo(
	event: NormalizedEvent,
	lastKnown: LastKnownSessionInfo
): void {
	if (
		event.kind !== "status" ||
		!SESSION_INFO_STATUSES.has(event.status) ||
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

/** The read-back event the handle pushes once the SDK has APPLIED a
 * `setPermissionMode` — the web's menu is controlled by the latest reported
 * value, so without this it snapped back to the startup mode after every
 * switch (and after a reload, which only replays the original session_ready). */
function permissionModeChangedEvent(mode: string): NormalizedEvent {
	return {
		kind: "status",
		status: "permission_mode_changed",
		detail: { permissionMode: mode },
	};
}

/** `permissionModeChangedEvent`'s twin for a `setModel` switch. */
function modelChangedEvent(model: string): NormalizedEvent {
	return {
		kind: "status",
		status: "model_changed",
		detail: { model },
	};
}

/** The SDK control methods `makeControlSetters` drives — a structural subset
 * of the SDK `Query` (mirrors `StatusQuery` above) so tests can hand in a
 * plain mock. */
interface ControlQuery {
	setModel(model: string): Promise<void>;
	setPermissionMode(mode: PermissionMode): Promise<void>;
}

/** The handle's `setModel`/`setPermissionMode` with read-back: the SDK has no
 * change-notification for its own applied switches, so once the call RESOLVES
 * a read-back status event is pushed — the web's menus are controlled by the
 * latest reported value, and this (persisted like any event) is what keeps
 * the display honest mid-session and across reloads. Lives here (not
 * claude-code.ts) purely for that file's 300-line limit. */
export function makeControlSetters(
	session: ControlQuery,
	events: EventSink,
	lastKnown: LastKnownSessionInfo
): Pick<AgentHandle, "setModel" | "setPermissionMode"> {
	return {
		setModel(model: string): void {
			lastKnown.model = model;
			session
				.setModel(model)
				.then(() => events.push(modelChangedEvent(model)))
				.catch(() => undefined);
		},
		setPermissionMode(mode: string): void {
			if (isPermissionMode(mode)) {
				lastKnown.permissionMode = mode;
				session
					.setPermissionMode(mode)
					.then(() => events.push(permissionModeChangedEvent(mode)))
					.catch(() => undefined);
			}
		},
	};
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

// (The `fetchSupportedModels`/`withReportedModels` copies that used to live
// here were dead code — claude-code.ts imports the real ones from
// claude-code-models.ts, which also resolves the init line's canonical model
// id to its alias row.)

/** R4-T1: how long `getStatus` waits on the (cached) claude quota fetch
 * before proceeding without it — the brief's "race 5s", independent of the
 * quota fetcher's own internal HTTP timeout (see quota/claude-quota.ts). A
 * cache hit resolves near-instantly; only a cold/expired lookup ever gets
 * close to this. */
const QUOTA_TIMEOUT_MS = 5000;

/** One cache per CLI process — quota barely changes between a session's
 * successive `getStatus` polls, so this is shared across every claude-code
 * session the process drives (see quota/quota-cache.ts's own doc comment).
 * Tests inject their own `QuotaCache` into `makeClaudeGetStatus` instead of
 * hitting this one, so it's never exercised outside a real run. */
const defaultClaudeQuotaCache: QuotaCache = createQuotaCache(fetchClaudeQuota);

/** Assembles the snapshot from whatever resolved: a piece that failed or
 * timed out is simply absent, never an error — the web renders what arrived. */
function buildSnapshotDetail(
	usage: SDKControlGetContextUsageResponse | undefined,
	servers: McpServerStatus[] | undefined,
	lastKnown: LastKnownSessionInfo,
	quota: QuotaSnapshot | undefined
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
		quota,
	};
}

/** Builds the `AgentHandle.getStatus` implementation: fetches context usage +
 * MCP statuses off the SDK control channel (each guarded — see
 * `resolveGuarded`) plus the account's quota (R4-T1, guarded by
 * `QUOTA_TIMEOUT_MS` via the shared `quotaCache`) and pushes one
 * `status_snapshot` event with whatever resolved. Fire-and-forget, matching
 * `makeListSessions`'s shape. `quotaCache` defaults to the process-wide
 * cache; tests pass a fake so no real fs/network call happens. */
export function makeClaudeGetStatus(
	session: StatusQuery,
	events: EventSink,
	lastKnown: LastKnownSessionInfo,
	quotaCache: QuotaCache = defaultClaudeQuotaCache
): () => void {
	return () => {
		Promise.all([
			resolveGuarded(() => session.getContextUsage()),
			resolveGuarded(() => session.mcpServerStatus()),
			withTimeout(quotaCache.get(), QUOTA_TIMEOUT_MS, undefined),
		]).then(([usage, servers, quota]) => {
			events.push({
				kind: "status",
				status: STATUS_SNAPSHOT_STATUS,
				detail: buildSnapshotDetail(usage, servers, lastKnown, quota),
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
