import type { PtySessionRow } from "@better-agent/agent/pty-session-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import { encodeKill } from "../pty/frame";
import { query, workspace } from "./pty-query";

// PTY router (P2-3a → P25-A). Sessions are now PERSISTENT: `createSession`
// mints a STABLE sessionId backed by a `pty_sessions` row and returns the spawn
// spec, but spawns NOTHING — the CLI spawns the pty on the first OPEN carrying
// that id, and re-entering the terminal with the same id reattaches the SAME
// pty (scrollback + running agent intact) instead of starting fresh. The row
// survives viewer detach; only `endSession` (which tells the CLI to kill the
// pty) or the CLI-restart reconciliation flips it to `ended`. The server still
// never spawns anything and never touches DATA — the byte relay is unchanged.

const AGENT_KINDS = ["claude-code", "opencode", "codex", "pi"] as const;

// The CLI binary each runtime maps to (mirrors the CLI's AGENT_CLI table). The
// browser relays this in the OPEN spec, but it is decided HERE — a viewer can
// only ask its own computer to run one of the known agent runtimes, never an
// arbitrary command it invents.
const AGENT_BINARY: Record<(typeof AGENT_KINDS)[number], string> = {
	"claude-code": "claude",
	opencode: "opencode",
	codex: "codex",
	pi: "pi",
};

const MAX_TITLE_LEN = 200;

/** The server-generated default title, e.g. `Session 7/26 14:30`. */
function defaultTitle(now: Date): string {
	const month = now.getMonth() + 1;
	const day = now.getDate();
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	return `Session ${month}/${day} ${hh}:${mm}`;
}

/** Assemble the spawn spec the CLI needs from a persisted session row plus its
 * resolved cwd. Shared by `createSession` (a fresh row) and `getSession` (a
 * reattach): claude/pi resume under OUR pty id, while codex/opencode resume
 * under the id the CLI bound (null until then). `agentSessionStarted` is the bit
 * that drives create-vs-resume — false on a fresh row, true once the underlying
 * conversation has been created, so a respawn after the pty died resumes it. */
function toSpawnSpec(session: PtySessionRow, cwd: string) {
	const usesOwnId =
		session.agentKind === "claude-code" || session.agentKind === "pi";
	return {
		agentKind: session.agentKind,
		agentSessionId: usesOwnId ? session.id : session.agentSessionId,
		agentSessionStarted: session.agentSessionStarted,
		args: [] as string[],
		command:
			AGENT_BINARY[session.agentKind as (typeof AGENT_KINDS)[number]] ??
			session.agentKind,
		computerId: session.computerId,
		cwd,
		sessionId: session.id,
	};
}

async function authorizeComputer(
	context: Context,
	userId: string,
	computerId: string
) {
	const computer = await context.services.stores.computer.getById(computerId);
	if (!computer || computer.userId !== userId) {
		throw new ORPCError("NOT_FOUND", { message: "Computer not found" });
	}
	return computer;
}

/** `createSession` — authorize a computer (and optional project), persist a new
 * active session row, and return its STABLE id plus the resolved spawn spec. An
 * empty `cwd` means "the computer's home directory" (resolved CLI-side); a
 * project's `localPath` is used when a ready project is named. Spawns nothing —
 * the CLI does that on the first OPEN carrying this id. */
const createSession = authorizedUserProcedure
	.input(
		z.object({
			agentKind: z.enum(AGENT_KINDS),
			computerId: z.uuid(),
			projectId: z.uuid().optional(),
		})
	)
	.handler(async ({ input, context }) => {
		const userId = context.authedUser.id;
		await authorizeComputer(context, userId, input.computerId);

		let cwd = "";
		if (input.projectId) {
			const project = await context.services.stores.project.getById(
				input.projectId,
				userId
			);
			if (!project || project.computerId !== input.computerId) {
				throw new ORPCError("NOT_FOUND", { message: "Project not found" });
			}
			if (project.status !== "ready" || !project.localPath) {
				throw new ORPCError("PRECONDITION_FAILED", {
					message:
						"Project isn't cloned yet — wait for it to finish, then open a terminal.",
				});
			}
			cwd = project.localPath;
		}

		const session = await context.services.stores.ptySession.create({
			userId,
			computerId: input.computerId,
			projectId: input.projectId ?? null,
			agentKind: input.agentKind,
			title: defaultTitle(new Date()),
		});

		// P25-C: claude/pi accept OUR id as their session id (`--session-id <id>`),
		// so the resumable id is the pty id itself; codex/opencode generate their
		// own, captured by the CLI after the first spawn (null until then). The
		// conversation hasn't been created yet, so `agentSessionStarted` is false —
		// the CLI creates on the first spawn and resumes on a later respawn.
		return toSpawnSpec(session, cwd);
	});

/** `getSession` — the reattach spec source (P25-C web). Returns the SAME spawn
 * spec shape `createSession` mints, rebuilt from the persisted row, so a viewer
 * reattaching (its URL carries only the session id) can still put a full spec on
 * the OPEN frame: a LIVE pty ignores it, but a pty that DIED (process exit / CLI
 * restart) is RESUMED — `agentSessionStarted` sends the CLI down its resume
 * command instead of losing the conversation. Owner-scoped; cwd re-resolved from
 * the session's project (best-effort — a missing/uncloned project falls back to
 * the home directory rather than blocking the reattach). */
const getSession = authorizedUserProcedure
	.input(z.object({ sessionId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const userId = context.authedUser.id;
		const session = await context.services.stores.ptySession.getById(
			input.sessionId,
			userId
		);
		if (!session) {
			throw new ORPCError("NOT_FOUND", { message: "Session not found" });
		}

		let cwd = "";
		if (session.projectId) {
			const project = await context.services.stores.project.getById(
				session.projectId,
				userId
			);
			if (project?.localPath) {
				cwd = project.localPath;
			}
		}

		return toSpawnSpec(session, cwd);
	});

/** `listSessions` — the computer's active sessions (optionally scoped to a
 * project), most-recently-active first. Backs the project's one-click reattach
 * list (P25-B). */
const listSessions = authorizedUserProcedure
	.input(
		z.object({
			computerId: z.uuid(),
			projectId: z.uuid().optional(),
		})
	)
	.handler(async ({ input, context }) => {
		const userId = context.authedUser.id;
		await authorizeComputer(context, userId, input.computerId);
		const sessions =
			await context.services.stores.ptySession.listActiveByComputer(
				userId,
				input.computerId,
				input.projectId
			);
		return {
			sessions: sessions.map((s) => ({
				sessionId: s.id,
				title: s.title,
				status: s.status,
				agentKind: s.agentKind,
				projectId: s.projectId,
				lastActivityAt: s.lastActivityAt,
				createdAt: s.createdAt,
			})),
		};
	});

/** `endSession` — the explicit stop. Marks the row `ended` and tells the CLI to
 * kill the pty (a detach never does). Idempotent; owner-scoped. */
const endSession = authorizedUserProcedure
	.input(z.object({ sessionId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const userId = context.authedUser.id;
		const ended = await context.services.stores.ptySession.markEnded(
			input.sessionId,
			userId
		);
		if (!ended) {
			throw new ORPCError("NOT_FOUND", { message: "Session not found" });
		}
		context.services.ptyRelay.sendToAgent(
			ended.computerId,
			encodeKill(ended.id)
		);
		return { ok: true as const };
	});

/** `renameSession` — owner-scoped title edit. */
const renameSession = authorizedUserProcedure
	.input(
		z.object({
			sessionId: z.uuid(),
			title: z.string().trim().min(1).max(MAX_TITLE_LEN),
		})
	)
	.handler(async ({ input, context }) => {
		const userId = context.authedUser.id;
		const renamed = await context.services.stores.ptySession.rename(
			input.sessionId,
			userId,
			input.title
		);
		if (!renamed) {
			throw new ORPCError("NOT_FOUND", { message: "Session not found" });
		}
		return { sessionId: renamed.id, title: renamed.title };
	});

export const ptyRouter = {
	createSession,
	getSession,
	listSessions,
	endSession,
	renameSession,
	// DP-WS: the terminal page's Files/Git/Shell side panes (pty-query.ts).
	query,
	workspace,
};
