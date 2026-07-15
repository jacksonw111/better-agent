import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClaudeCodeNormalizer } from "../normalize/claude-code";
import type { NormalizedEvent } from "../normalize/types";
import { userMessageEvent } from "../normalize/types";
import {
	type ApprovalRegistry,
	createApprovalRegistry,
	retractPendingApprovals,
} from "./approvals";
import { type AsyncQueue, createAsyncQueue } from "./async-queue";
import { type EventSink, makeCanUseTool } from "./claude-code-approvals";
import {
	commandCatalogEvent,
	fetchSupportedCommands,
} from "./claude-code-commands";
import {
	type ClaudeQuery,
	fetchSupportedModels,
	withReportedModels,
	withSessionCapabilities,
} from "./claude-code-models";
import { writeSkillFiles } from "./claude-code-skills";
import {
	claudeMcpServers,
	configQueryOptions,
	isPermissionMode,
} from "./claude-code-startup-config";
import {
	type LastKnownSessionInfo,
	makeClaudeGetStatus,
	makeListSessions,
	recordSessionInfo,
} from "./claude-code-status";
import { userTurn } from "./claude-code-user-turn";
import { makeInterruptThenSend } from "./interrupt-then-send";
import { findOnPath } from "./process-io";
import { makeClaudeSearchSessions } from "./session-search-providers";
import {
	bumpTurnEpoch,
	createTurnEpoch,
	type TurnEpochRef,
	turnStampingQueue,
} from "./turn-epoch";
import type {
	Adapter,
	AgentHandle,
	AgentImage,
	ResolvedMcpServer,
	StartOptions,
} from "./types";

// Drives the LOCAL claude via the official Claude Agent SDK rather than
// hand-spawning `claude -p` and reverse-engineering its stream-json stdin
// protocol (which needs an undocumented `initialize` control handshake — the
// reason a hand-rolled process produced nothing). `query()` takes a streaming
// AsyncIterable of user turns, manages the claude subprocess + handshake, and
// yields SDK messages whose shapes match the CLI stream-json we already
// normalize. Tool permission requests route through `canUseTool` back to the
// web approval UI. P3-T2: `userTurn` (claude-code-user-turn.ts) builds the
// turn — a bare string, or a content-block array when downloaded images ride
// along.

/** The plumbing `drainSession` closes over — bundled into one object so it
 * stays under the repo's max-params gate (mirrors `StartClaudeQueryDeps`
 * below). */
interface DrainSessionDeps {
	events: AsyncQueue<NormalizedEvent>;
	lastKnown: LastKnownSessionInfo;
	models: Promise<string[] | undefined>;
	// R1-T2: the stateful normalizer — tracks tool_use/tool_result id pairs to
	// stamp durationMs adapter-side (the SDK carries no wire duration). One
	// instance per session, so state doesn't leak across sessions.
	normalize: (raw: unknown) => NormalizedEvent[];
	session: AsyncIterable<unknown>;
}

async function drainSession(deps: DrainSessionDeps): Promise<void> {
	const { events, lastKnown, models, normalize, session } = deps;
	try {
		for await (const message of session) {
			for (const event of normalize(message)) {
				// Seed the getStatus snapshot's model/permissionMode off the one-time
				// init event as it flows by (see claude-code-status.ts).
				recordSessionInfo(event, lastKnown);
				events.push(
					withSessionCapabilities(await withReportedModels(event, models))
				);
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
	/** R4: the sanitized names of the SKILL.md files the CLI already wrote for
	 * this session (see `writeSkillFiles`) — passed to the SDK `skills` option
	 * so exactly these are enabled. Empty → leave the SDK default (every
	 * discovered skill), not "skills off". */
	skillNames: string[];
}

/** Starts the SDK `query()` session: the claude subprocess + handshake, wired
 * to this handle's input queue, tool-approval routing, and persisted startup
 * config from the bridge token. */
function startClaudeQuery(deps: StartClaudeQueryDeps): ClaudeQuery {
	const { approvals, dir, events, input, opts, skillNames } = deps;
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
			// R5-b: MCP servers this session launched with (LIVE-replaceable — see
			// the handle's setMcpServers).
			mcpServers: claudeMcpServers(opts?.mcpServers),
			// R4: enable exactly the skills the CLI just wrote to .claude/skills;
			// omit when none so the SDK keeps its default (every discovered skill).
			skills: skillNames.length > 0 ? skillNames : undefined,
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
	// Cancels the in-flight turn only — unlike `stop`, the input/events queues
	// stay open so the user can keep chatting in the same session. Named (not
	// inline) so R3-T1's `sendWith("interrupt")` can call it before `doSend`.
	function doInterrupt(): void {
		bumpTurnEpoch(epoch);
		retractPendingApprovals(approvals, events);
		session.interrupt().catch(() => undefined);
	}
	function doSend(text: string, images?: AgentImage[]): void {
		// A new turn begins — bump the epoch BEFORE pushing the user's own
		// turn-start event, so everything from here on (including this event)
		// carries the new epoch.
		bumpTurnEpoch(epoch);
		// Persist the user's own turn (see userMessageEvent) so it survives
		// a page reload, THEN forward it to the agent. P3-T2: images (already
		// downloaded + base64'd by image-input.ts) become content blocks.
		events.push(userMessageEvent(text));
		input.push(userTurn(text, images));
	}
	return {
		events,
		getStatus: makeClaudeGetStatus(session, events, lastKnown),
		answerApproval(requestId: string, optionId: string): void {
			approvals.answer(requestId, optionId);
		},
		interrupt: doInterrupt,
		listSessions: makeListSessions(dir, events),
		// P4-T5: disk-side transcript search (the SDK has no content search).
		searchSessions: makeClaudeSearchSessions(dir, events),
		send: doSend,
		// R3-T1: "steer" isn't in claude-code's busyModes (session-capabilities.ts)
		// so it never reaches here — "interrupt" aborts then sends fresh; "queue"
		// falls through to plain doSend.
		sendWith: makeInterruptThenSend({ doInterrupt, doSend }),
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
		setMcpServers(servers: ResolvedMcpServer[]): void {
			// R5-b LIVE: replace the session's SDK MCP servers, no restart.
			// Fire-and-forget like setModel (result surfaces via next getStatus).
			session.setMcpServers(claudeMcpServers(servers)).catch(() => undefined);
		},
		reloadSkills(): void {
			// R4 LIVE: re-scan .claude/skills after the CLI (re)wrote SKILL.md.
			// Fire-and-forget; the refreshed skill list surfaces via next getStatus.
			session.reloadSkills().catch(() => undefined);
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
	async start(dir: string, opts?: StartOptions): Promise<AgentHandle> {
		const epoch = createTurnEpoch();
		const events = turnStampingQueue(
			createAsyncQueue<NormalizedEvent>(),
			epoch
		);
		const input = createAsyncQueue<SDKUserMessage>();
		const approvals = createApprovalRegistry(events);

		// R4: write the session's SKILL.md files BEFORE query() so the SDK
		// discovers them at start; the returned names enable exactly these.
		const skillNames = await writeSkillFiles(dir, opts?.skills);
		const session = startClaudeQuery({
			approvals,
			dir,
			events,
			input,
			opts,
			skillNames,
		});
		// Kicked off immediately: `supportedModels()` resolves off the same init
		// handshake that produces the `session_ready` line, so it's ready by the
		// time `withReportedModels` merges it in (see fetchSupportedModels).
		const models = fetchSupportedModels(session);
		// R5-T1: same control channel, its own one-time `command_catalog` event
		// (not merged into `session_ready` — unlike models, nothing else needs
		// it inline) — fire-and-forget, so `start()` doesn't wait on it.
		fetchSupportedCommands(session)
			.then((commands) => {
				if (commands && commands.length > 0) {
					events.push(commandCatalogEvent(commands));
				}
			})
			.catch(() => undefined);
		// getStatus's model/permissionMode source: the SDK has no on-demand read
		// for the permission mode, so the adapter tracks the last-known values
		// (init event + this handle's own setModel/setPermissionMode calls).
		const lastKnown: LastKnownSessionInfo = {};
		drainSession({
			events,
			lastKnown,
			models,
			normalize: createClaudeCodeNormalizer(),
			session,
		});

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
