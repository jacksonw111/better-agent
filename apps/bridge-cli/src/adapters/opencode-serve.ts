// `opencode serve` — opencode's HTTP + SSE server, driven over plain `fetch`
// (Node 22+ global). Opt-in via `--opencode-transport serve` (see args.ts);
// the ACP adapter (opencode.ts) stays the default until these wire shapes are
// verified against a real binary. Every request/stream shape assumption is
// marked ASSUMPTION here, in opencode-serve-http.ts, or in
// normalize/opencode-serve.ts. Unlike ACP this transport also unlocks the
// serve-only control surface (live `POST /mcp`, `GET/PATCH /config`,
// `GET /global/health`, on-demand history/usage) for later plan phases.

import {
	createOpencodeServeNormalizer,
	parseOpencodeServeModels,
} from "../normalize/opencode-serve";
import { parseOpencodeServeStatus } from "../normalize/opencode-serve-status";
import {
	isRecord,
	type NormalizedEvent,
	userMessageEvent,
} from "../normalize/types";
import { type ApprovalRegistry, createApprovalRegistry } from "./approvals";
import { createAsyncQueue } from "./async-queue";
import {
	createServeHttp,
	type EventSink,
	firePost,
	pumpServeEvents,
	type ServeHttp,
	waitForServeUrl,
} from "./opencode-serve-http";
import { spawnProcessIo } from "./process-io";
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

interface ServeSessionContext {
	approvals: ApprovalRegistry;
	events: EventSink;
	http: ServeHttp;
	sessionId: string;
}

/** Routes the SSE stream through this session's normalizer; an approval event
 * additionally registers its reply (the `POST …/permissions/:id` call —
 * ASSUMPTION, unverified: body `{ response: <optionId> }`, where the option
 * ids are the fixed once/always/reject vocabulary the normalizer announces)
 * before being pushed. Detached — a stream failure after `stop()`/exit
 * (signal aborted) is silent. */
function wireServeEventStream(
	ctx: ServeSessionContext,
	signal: AbortSignal
): void {
	const normalize = createOpencodeServeNormalizer(ctx.sessionId);
	const route = (data: unknown): void => {
		for (const event of normalize(data)) {
			if (event.kind === "approval") {
				ctx.approvals.register(event.requestId, event.options, (optionId) => {
					firePost(
						ctx.http,
						`/session/${ctx.sessionId}/permissions/${event.requestId}`,
						{ response: optionId },
						ctx.events
					);
				});
			}
			ctx.events.push(event);
		}
	};
	pumpServeEvents(ctx.http, signal, route).catch((error: unknown) => {
		if (signal.aborted) {
			return;
		}
		ctx.events.push({
			kind: "error",
			message: "opencode serve /event stream failed",
			detail: error instanceof Error ? error.message : error,
		});
	});
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

/** `opencode serve` + HTTP/SSE — the serve-backed opencode transport. */
export const opencodeServeAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const io = await spawnProcessIo("opencode", SERVE_ARGS, dir);
		const events = createAsyncQueue<NormalizedEvent>();
		const approvals = createApprovalRegistry(events);
		const sseAbort = new AbortController();
		io.onExit(() => {
			sseAbort.abort();
			events.push({ kind: "status", status: AGENT_EXITED_STATUS });
			events.close();
			approvals.clear();
		});

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

		const ctx: ServeSessionContext = { approvals, events, http, sessionId };
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
				sseAbort.abort();
				io.stop();
				events.close();
				approvals.clear();
			},
		};
	},
};
