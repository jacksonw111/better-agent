import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import { encodeKill } from "../pty/frame";

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

		return {
			args: [] as string[],
			command: AGENT_BINARY[input.agentKind],
			computerId: input.computerId,
			cwd,
			sessionId: session.id,
		};
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
	listSessions,
	endSession,
	renameSession,
};
