// `opencode serve` — opencode's HTTP + SSE server, driven over plain `fetch`
// (Node 22+ global). Opt-in via `--opencode-transport serve` (see args.ts);
// the ACP adapter (opencode.ts) stays the default until these wire shapes are
// verified against a real binary. Every request/stream shape ASSUMPTION is
// marked here, in opencode-serve-http.ts, or in normalize/opencode-serve.ts.

import { parseOpencodeServeModels } from "../normalize/opencode-serve";
import { isRecord, type NormalizedEvent } from "../normalize/types";
import { type ApprovalRegistry, createApprovalRegistry } from "./approvals";
import { type AsyncQueue, createAsyncQueue } from "./async-queue";
import {
	fetchServeAgents,
	fetchServeHealth,
	logServeHealth,
	type ServeAgentRef,
} from "./opencode-serve-agent";
import { wireServeEventStream } from "./opencode-serve-approvals";
import {
	buildServeHandle,
	pushServeSessionReady,
} from "./opencode-serve-controls";
import {
	createServeHttp,
	type EventSink,
	type ServeHttp,
	waitForServeUrl,
} from "./opencode-serve-http";
import { type ProcessIo, spawnProcessIo } from "./process-io";
import { createQuestionRegistry, type QuestionRegistry } from "./questions";
import {
	createTurnEpoch,
	type TurnEpochRef,
	turnStampingQueue,
} from "./turn-epoch";
import { type Adapter, AGENT_EXITED_STATUS, type AgentHandle } from "./types";

/** R3-T3: which permission-reply route this session's health probe (fetched
 * in `start`, before the SSE stream — see the race-condition note below)
 * settled on. `"unknown"` until the probe resolves — `wireServeEventStream`
 * is wired BEFORE `Promise.all([...health probe])` resolves, so a permission
 * can race in before the hint is known; opencode-serve-approvals.ts's
 * `postPermissionReply` tries the new route and falls back once on a 404 in
 * that case. `"new"`: the probe succeeded (a modern server) — new route only.
 * `"legacy"`: the probe failed (an old server, or the route itself 404s) —
 * deprecated route only, skipping a doomed new-route attempt. */
export interface PermissionRouteHint {
	current: "legacy" | "new" | "unknown";
}

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
	/** R3-T3: see `PermissionRouteHint`'s own doc comment. */
	permissionRouteHint: PermissionRouteHint;
	questions: QuestionRegistry;
	sessionId: string;
}

/** Wires the turn-epoch-stamped event queue, approval registry, and the
 * process-exit cleanup shared by every serve session — extracted purely so
 * `start` stays under the line gate. */
function createServePipeline(io: ProcessIo): {
	approvals: ApprovalRegistry;
	epoch: TurnEpochRef;
	events: AsyncQueue<NormalizedEvent>;
	permissionRouteHint: PermissionRouteHint;
	questions: QuestionRegistry;
	sseAbort: AbortController;
} {
	const epoch = createTurnEpoch();
	const events = turnStampingQueue(createAsyncQueue<NormalizedEvent>(), epoch);
	const approvals = createApprovalRegistry(events);
	const questions = createQuestionRegistry(events);
	const permissionRouteHint: PermissionRouteHint = { current: "unknown" };
	const sseAbort = new AbortController();
	io.onExit(() => {
		sseAbort.abort();
		events.push({ kind: "status", status: AGENT_EXITED_STATUS });
		events.close();
		approvals.clear();
		questions.clear();
	});
	return { approvals, epoch, events, permissionRouteHint, questions, sseAbort };
}

/** `opencode serve` + HTTP/SSE — the serve-backed opencode transport. */
export const opencodeServeAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const io = await spawnProcessIo("opencode", SERVE_ARGS, dir);
		const {
			approvals,
			epoch,
			events,
			permissionRouteHint,
			questions,
			sseAbort,
		} = createServePipeline(io);

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
			permissionRouteHint,
			questions,
			sessionId,
		};
		wireServeEventStream(ctx, sseAbort.signal);
		// R3-T3: unlike models/permissionModes, health ALSO decides
		// `permissionRouteHint` (item 4) — `wireServeEventStream` above is wired
		// before this resolves, so a permission racing in ahead of it sees
		// `"unknown"` and opencode-serve-approvals.ts tries the new route first.
		const [models, permissionModes, health] = await Promise.all([
			fetchServeModels(http),
			fetchServeAgents(http),
			fetchServeHealth(http),
		]);
		permissionRouteHint.current = health === undefined ? "legacy" : "new";
		logServeHealth(health);
		pushServeSessionReady(ctx, dir, models, permissionModes);

		const agentRef: ServeAgentRef = {};
		return buildServeHandle(ctx, events, { agentRef, io, sseAbort });
	},
};
