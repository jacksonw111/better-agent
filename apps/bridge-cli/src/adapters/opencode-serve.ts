// `opencode serve` — opencode's HTTP + SSE server, driven over plain `fetch`
// (Node 22+ global). Opt-in via `--opencode-transport serve` (see args.ts);
// the ACP adapter (opencode.ts) stays the default until these wire shapes are
// verified against a real binary. Every request/stream shape assumption is
// marked ASSUMPTION here, in opencode-serve-http.ts, or in
// normalize/opencode-serve.ts. Unlike ACP this transport also unlocks the
// serve-only control surface (live `POST /mcp`, `GET/PATCH /config`,
// `GET /global/health`, on-demand history/usage) for later plan phases.

import { parseOpencodeServeModels } from "../normalize/opencode-serve";
import { parseOpencodeServeStatus } from "../normalize/opencode-serve-status";
import {
	isRecord,
	type NormalizedEvent,
	userMessageEvent,
} from "../normalize/types";
import {
	type ApprovalRegistry,
	createApprovalRegistry,
	retractPendingApprovals,
} from "./approvals";
import { type AsyncQueue, createAsyncQueue } from "./async-queue";
import { wireServeEventStream } from "./opencode-serve-approvals";
import {
	createServeHttp,
	type EventSink,
	firePost,
	type ServeHttp,
	waitForServeUrl,
} from "./opencode-serve-http";
import { type ProcessIo, spawnProcessIo } from "./process-io";
import {
	bumpTurnEpoch,
	createTurnEpoch,
	type TurnEpochRef,
	turnStampingQueue,
} from "./turn-epoch";
import {
	type Adapter,
	AGENT_EXITED_STATUS,
	type AgentHandle,
	STATUS_SNAPSHOT_STATUS,
} from "./types";

// See the ASSUMPTION on `waitForServeUrl` (opencode-serve-http.ts) for why
// port 0: the OS assigns a free port and the printed URL tells us which.
const SERVE_ARGS = ["serve", "--port", "0", "--hostname", "127.0.0.1"];

// ASSUMPTION (unverified): `POST /session` with an empty JSON body creates a
// session rooted at the server's cwd (we spawn `opencode serve` IN the target
// dir) and responds with the session record, `{ id: "ses_…", … }`.
async function createServeSession(http: ServeHttp): Promise<string> {
	const created = await http.postJson("/session", {});
	if (isRecord(created) && typeof created.id === "string") {
		return created.id;
	}
	throw new Error("opencode serve POST /session returned no session id");
}

async function fetchServeModels(http: ServeHttp): Promise<string[]> {
	try {
		return parseOpencodeServeModels(await http.getJson("/config/providers"));
	} catch {
		return []; // model list is a nice-to-have; session_ready ships without it
	}
}

export interface ServeSessionContext {
	approvals: ApprovalRegistry;
	epoch: TurnEpochRef;
	events: EventSink;
	http: ServeHttp;
	sessionId: string;
}

/** Serve has no stateful model setter — the model rides on EVERY prompt as
 * `{ providerID, modelID }` (ASSUMPTION, unverified: `POST
 * /session/:id/message` accepts `{ parts: [{ type: "text", text }], model? }`
 * and streams the turn's updates on /event; its own response — the finished
 * message — is ignored). `setModel` therefore just stores the split
 * "provider/model" string for subsequent sends. */
interface ServeModelRef {
	current?: { modelID: string; providerID: string };
}

function parseServeModelRef(model: string): ServeModelRef["current"] {
	const separator = model.indexOf("/");
	const isValid = separator > 0 && separator !== model.length - 1;
	return isValid
		? {
				providerID: model.slice(0, separator),
				modelID: model.slice(separator + 1),
			}
		: undefined;
}

function makeServeControls(
	ctx: ServeSessionContext,
	modelRef: ServeModelRef
): Pick<AgentHandle, "send" | "setModel" | "interrupt"> {
	return {
		send(text: string): void {
			// A new turn begins — bump the epoch BEFORE pushing the user's own
			// turn-start event (see the RC-T3 note on `opencodeServeAdapter.start`).
			bumpTurnEpoch(ctx.epoch);
			ctx.events.push(userMessageEvent(text));
			const body: Record<string, unknown> = {
				parts: [{ type: "text", text }],
			};
			if (modelRef.current !== undefined) {
				body.model = modelRef.current;
			}
			firePost(ctx.http, `/session/${ctx.sessionId}/message`, body, ctx.events);
		},
		setModel(model: string): void {
			const parsed = parseServeModelRef(model);
			if (parsed === undefined) {
				ctx.events.push({
					kind: "status",
					status: "model_format_invalid",
					detail: { model, expected: "provider/model" },
				});
				return;
			}
			modelRef.current = parsed;
		},
		interrupt(): void {
			// RC-T3: supersede the current turn and retract any pending approval
			// (pending permission request) BEFORE aborting the remote turn, so a
			// straggler SSE event or a late approval answer can never land against
			// a turn context that's already moved on — mirrors claude-code.ts's
			// `interrupt()`.
			bumpTurnEpoch(ctx.epoch);
			retractPendingApprovals(ctx.approvals, ctx.events);
			// ASSUMPTION (unverified): `POST /session/:id/abort` cancels the
			// in-flight turn but keeps the session alive.
			firePost(
				ctx.http,
				`/session/${ctx.sessionId}/abort`,
				undefined,
				ctx.events
			);
		},
	};
}

/** Builds the `getStatus` control: GETs the serve session's message history
 * and maps the latest assistant message's cost/tokens/model into ONE
 * `status_snapshot` event — see the ASSUMPTION note on
 * `parseOpencodeServeStatus` (normalize/opencode-serve-status.ts) for the
 * endpoint/shape this assumes. A fetch failure pushes a snapshot with every
 * field absent rather than throwing or surfacing a raw `error` event —
 * matching every other adapter's "the web renders whatever arrived" posture
 * for `getStatus` (see e.g. claude-code-status.ts's `buildSnapshotDetail`). */
function makeServeGetStatus(ctx: ServeSessionContext): () => void {
	return () => {
		ctx.http
			.getJson(`/session/${ctx.sessionId}/message`)
			.then((raw) => {
				ctx.events.push({
					kind: "status",
					status: STATUS_SNAPSHOT_STATUS,
					detail: parseOpencodeServeStatus(raw),
				});
			})
			.catch(() => {
				ctx.events.push({
					kind: "status",
					status: STATUS_SNAPSHOT_STATUS,
					detail: {},
				});
			});
	};
}

/** Wires the turn-epoch-stamped event queue, approval registry, and the
 * process-exit cleanup shared by every serve session — extracted purely so
 * `start` stays under the line gate. */
function createServePipeline(io: ProcessIo): {
	approvals: ApprovalRegistry;
	epoch: TurnEpochRef;
	events: AsyncQueue<NormalizedEvent>;
	sseAbort: AbortController;
} {
	const epoch = createTurnEpoch();
	const events = turnStampingQueue(createAsyncQueue<NormalizedEvent>(), epoch);
	const approvals = createApprovalRegistry(events);
	const sseAbort = new AbortController();
	io.onExit(() => {
		sseAbort.abort();
		events.push({ kind: "status", status: AGENT_EXITED_STATUS });
		events.close();
		approvals.clear();
	});
	return { approvals, epoch, events, sseAbort };
}

/** `opencode serve` + HTTP/SSE — the serve-backed opencode transport. */
export const opencodeServeAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const io = await spawnProcessIo("opencode", SERVE_ARGS, dir);
		const { approvals, epoch, events, sseAbort } = createServePipeline(io);

		let http: ServeHttp;
		let sessionId: string;
		try {
			const baseUrl = await waitForServeUrl(io);
			http = createServeHttp(baseUrl, process.env.OPENCODE_SERVER_PASSWORD);
			sessionId = await createServeSession(http);
		} catch (error) {
			io.stop();
			throw error;
		}

		const ctx: ServeSessionContext = {
			approvals,
			epoch,
			events,
			http,
			sessionId,
		};
		wireServeEventStream(ctx, sseAbort.signal);
		events.push({
			kind: "status",
			status: "session_ready",
			detail: { cwd: dir, sessionId, models: await fetchServeModels(http) },
		});

		return {
			answerApproval(requestId: string, optionId: string): void {
				approvals.answer(requestId, optionId);
			},
			events,
			getStatus: makeServeGetStatus(ctx),
			...makeServeControls(ctx, {}),
			stop(): void {
				bumpTurnEpoch(epoch);
				// Retract before close(): a push after the queue is closed is a
				// silent no-op (see async-queue.ts), so the cancelled ApprovalEvent
				// must land first.
				retractPendingApprovals(approvals, events);
				sseAbort.abort();
				io.stop();
				events.close();
				approvals.clear();
			},
		};
	},
};
