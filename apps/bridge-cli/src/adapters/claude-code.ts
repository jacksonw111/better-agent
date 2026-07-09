import {
	type CanUseTool,
	type PermissionResult,
	query,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { normalizeClaudeCode } from "../normalize/claude-code";
import type { ApprovalOption, NormalizedEvent } from "../normalize/types";
import { userMessageEvent } from "../normalize/types";
import {
	type ApprovalRegistry,
	createApprovalRegistry,
	presentApproval,
	retractPendingApprovals,
} from "./approvals";
import { type AsyncQueue, createAsyncQueue } from "./async-queue";
import {
	type ClaudeQuery,
	fetchSupportedModels,
	withReportedModels,
} from "./claude-code-models";
import {
	configQueryOptions,
	isPermissionMode,
} from "./claude-code-startup-config";
import {
	type LastKnownSessionInfo,
	makeClaudeGetStatus,
	makeListSessions,
	recordSessionInfo,
} from "./claude-code-status";
import { findOnPath } from "./process-io";
import {
	bumpTurnEpoch,
	createTurnEpoch,
	type TurnEpochRef,
	turnStampingQueue,
} from "./turn-epoch";
import type { Adapter, AgentHandle, StartOptions } from "./types";

// Drives the LOCAL claude via the official Claude Agent SDK rather than
// hand-spawning `claude -p` and reverse-engineering its stream-json stdin
// protocol (which needs an undocumented `initialize` control handshake — the
// reason a hand-rolled process produced nothing). `query()` takes a streaming
// AsyncIterable of user turns, manages the claude subprocess + handshake, and
// yields SDK messages whose shapes match the CLI stream-json we already
// normalize. Tool permission requests route through `canUseTool` back to the
// web approval UI.

const APPROVAL_OPTIONS: ApprovalOption[] = [
	{ id: "allow", label: "Allow" },
	{ id: "deny", label: "Deny" },
];

/** FIX2 (rc-final-review): the SDK's `PermissionResult` requires a `message`
 * on every `deny` — this is what an unanswered approval resolves to once the
 * shared RC-T4 timeout (`presentApproval`) gives up, same fail-closed
 * contract every other adapter's approvals already get. */
const APPROVAL_TIMEOUT_DENY_MESSAGE =
	"Timed out waiting for approval — denied.";

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function userTurn(text: string): SDKUserMessage {
	return {
		type: "user",
		message: { role: "user", content: text },
		parent_tool_use_id: null,
	};
}

interface EventSink {
	push(event: NormalizedEvent): void;
}

// Turns each SDK tool-permission request into an approval event and blocks on
// the user's web decision (resolved via the handle's answerApproval). Backed
// by the shared `ApprovalRegistry` (not a bare requestId->resolver map) so
// `interrupt()`/`stop()` can retract every still-pending request through the
// same `retractPendingApprovals` helper the other adapters use — see the
// RC-T3 module doc on `handle.interrupt` below for why that matters.
//
// FIX2 (rc-final-review): routed through the shared RC-T4 fail-closed
// contract (`presentApproval`) exactly like codex/opencode/pi's approvals —
// this used to call `approvals.register` directly, with no timeout of its
// own. Combined with the RC-T5 watchdog pausing while an approval card is
// open (`session-watchdog.ts`'s `observeApprovalEvent`), an unanswered claude
// approval could hang the session indefinitely; now it resolves a visible
// DENY after `APPROVAL_TIMEOUT_MS`, same as every other adapter.
function makeCanUseTool(
	events: EventSink,
	approvals: ApprovalRegistry
): CanUseTool {
	return (toolName, toolInput, options) => {
		const requestId = options.toolUseID;
		return new Promise<PermissionResult>((resolve) => {
			presentApproval({
				approvals,
				event: {
					kind: "approval",
					requestId,
					title: `Use ${toolName}?`,
					detail: safeJson(toolInput),
					options: APPROVAL_OPTIONS,
				},
				events,
				onAnswer: (optionId) => {
					resolve(
						optionId === "allow"
							? { behavior: "allow", updatedInput: toolInput }
							: { behavior: "deny", message: "Denied from the bridge." }
					);
				},
				onTimeout: () => {
					resolve({
						behavior: "deny",
						message: APPROVAL_TIMEOUT_DENY_MESSAGE,
					});
				},
			});
		});
	};
}

async function drainSession(
	session: AsyncIterable<unknown>,
	events: AsyncQueue<NormalizedEvent>,
	models: Promise<string[] | undefined>,
	lastKnown: LastKnownSessionInfo
): Promise<void> {
	try {
		for await (const message of session) {
			for (const event of normalizeClaudeCode(message)) {
				// Seed the getStatus snapshot's model/permissionMode off the one-time
				// init event as it flows by (see claude-code-status.ts).
				recordSessionInfo(event, lastKnown);
				events.push(await withReportedModels(event, models));
			}
		}
	} catch (error) {
		events.push({
			kind: "error",
			message: error instanceof Error ? error.message : String(error),
		});
	}
	events.close();
}

/** The plumbing `startClaudeQuery` closes over — bundled into one object
 * (mirroring `ClaudeHandleDeps` below) so the function stays under this
 * file's max-params lint gate. */
interface StartClaudeQueryDeps {
	approvals: ApprovalRegistry;
	dir: string;
	events: EventSink;
	input: AsyncQueue<SDKUserMessage>;
	opts: StartOptions | undefined;
}

/** Starts the SDK `query()` session: the claude subprocess + handshake, wired
 * to this handle's input queue, tool-approval routing, and persisted startup
 * config from the bridge token. */
function startClaudeQuery(deps: StartClaudeQueryDeps): ClaudeQuery {
	const { approvals, dir, events, input, opts } = deps;
	return query({
		prompt: input,
		options: {
			cwd: dir,
			pathToClaudeCodeExecutable: findOnPath("claude"), // user's PATH claude (standalone binary omits the SDK's bundled one)
			// A prior `--resume` claude session id (undefined starts fresh).
			resume: opts?.resume,
			canUseTool: makeCanUseTool(events, approvals),
			// Phase 4 + R2-b: apply persisted startup config from the bridge token
			// (systemPrompt/maxTurns/maxBudgetUsd/effort/model/permissionMode).
			...configQueryOptions(opts?.config),
			// Extended thinking's reasoning text only streams as `thinking_delta`
			// frames under includePartialMessages — which also streams the
			// response text as `text_delta` frames, duplicating what later
			// arrives (again) as a text block on the final assistant message.
			// `normalizeClaudeCode` is the dedup point: it treats the streamed
			// deltas as the source of truth and drops the final assistant
			// message's text blocks (keeping its tool_use blocks).
			includePartialMessages: true,
			thinking: { type: "adaptive" },
		},
	});
}

/** The shared plumbing `buildClaudeHandle` closes over — bundled into one
 * object so it stays under the repo's max-params gate (mirrors codex.ts's
 * `CodexHandleDeps`/opencode's equivalent). */
interface ClaudeHandleDeps {
	approvals: ApprovalRegistry;
	dir: string;
	epoch: TurnEpochRef;
	events: AsyncQueue<NormalizedEvent>;
	input: AsyncQueue<SDKUserMessage>;
	lastKnown: LastKnownSessionInfo;
	session: ClaudeQuery;
}

/** Assembles the returned `AgentHandle` — the session's public surface —
 * once `startClaudeQuery` + `drainSession` are wired up.
 *
 * RC-T3 (docs/remote-control-redesign-plan.md, Pillar 3): fixes the audited
 * bug where `interrupt()` called `session.interrupt()` but never touched the
 * approvals map — a pending approval card survived into the NEXT turn, and
 * the user's later answer resolved a `canUseTool` promise whose turn context
 * had already moved on. `send`/`interrupt`/`stop` now all bump the shared
 * turn epoch (stamped onto every event via `events`, already wrapped by
 * `turnStampingQueue` in `start`), and `interrupt`/`stop` additionally
 * retract every pending approval — clearing the resolver (so a late
 * `answerApproval` for it is the registry's normal "unknown id" no-op) and
 * pushing a cancelled `ApprovalEvent` so the web removes the open card. */
function buildClaudeHandle(deps: ClaudeHandleDeps): AgentHandle {
	const { approvals, dir, epoch, events, input, lastKnown, session } = deps;
	return {
		events,
		getStatus: makeClaudeGetStatus(session, events, lastKnown),
		answerApproval(requestId: string, optionId: string): void {
			approvals.answer(requestId, optionId);
		},
		// Cancels the in-flight turn only — unlike `stop`, the input/events
		// queues stay open so the user can keep chatting in the same session.
		interrupt(): void {
			bumpTurnEpoch(epoch);
			retractPendingApprovals(approvals, events);
			session.interrupt().catch(() => undefined);
		},
		listSessions: makeListSessions(dir, events),
		send(text: string): void {
			// A new turn begins — bump the epoch BEFORE pushing the user's own
			// turn-start event, so everything from here on (including this event)
			// carries the new epoch.
			bumpTurnEpoch(epoch);
			// Persist the user's own turn (see userMessageEvent) so it survives
			// a page reload, THEN forward it to the agent.
			events.push(userMessageEvent(text));
			input.push(userTurn(text));
		},
		setModel(model: string): void {
			lastKnown.model = model;
			session.setModel(model).catch(() => undefined);
		},
		setPermissionMode(mode: string): void {
			if (isPermissionMode(mode)) {
				lastKnown.permissionMode = mode;
				session.setPermissionMode(mode).catch(() => undefined);
			}
		},
		stop(): void {
			bumpTurnEpoch(epoch);
			retractPendingApprovals(approvals, events);
			input.close();
			session.interrupt().catch(() => undefined);
			events.close();
		},
	};
}

export const claudeCodeAdapter: Adapter = {
	// biome-ignore lint/suspicious/useAwait: the Adapter interface returns a Promise; the SDK query starts lazily.
	async start(dir: string, opts?: StartOptions): Promise<AgentHandle> {
		const epoch = createTurnEpoch();
		const events = turnStampingQueue(
			createAsyncQueue<NormalizedEvent>(),
			epoch
		);
		const input = createAsyncQueue<SDKUserMessage>();
		const approvals = createApprovalRegistry(events);

		const session = startClaudeQuery({ approvals, dir, events, input, opts });
		// Kicked off immediately: `supportedModels()` resolves off the same init
		// handshake that produces the `session_ready` line, so it's ready by the
		// time `withReportedModels` merges it in (see fetchSupportedModels).
		const models = fetchSupportedModels(session);
		// getStatus's model/permissionMode source: the SDK has no on-demand read
		// for the permission mode, so the adapter tracks the last-known values
		// (init event + this handle's own setModel/setPermissionMode calls).
		const lastKnown: LastKnownSessionInfo = {};
		drainSession(session, events, models, lastKnown);

		return buildClaudeHandle({
			approvals,
			dir,
			epoch,
			events,
			input,
			lastKnown,
			session,
		});
	},
};
