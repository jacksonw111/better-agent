import type { ProjectRow } from "@better-agent/agent/project-ports";
import type { PtySessionRow } from "@better-agent/agent/pty-session-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import { isSafeRelativePath, QUERY_PATH_MAX_LENGTH } from "./projects-query";

// DP-WS: the session-workspace query loop — the terminal page's Files/Git/Shell
// side panes. It generalizes the read-only project query (projects-query.ts)
// from "a Project's checkout" to "a PTY session's workspace": the server
// resolves the session's workspace root (its project's localPath, or "" → the
// CLI's home dir for a project-less session), then reuses the SAME park hub,
// control-WS push, `projects.submitQueryResult` answer path and timeout as the
// project loop — only the frame kind (workspace_query) and the extra `shell` op
// differ. Pure real-time by design: a Computer with no live control socket
// fails fast (PRECONDITION_FAILED), an unanswered query times out.

const SHELL_CMD_MAX_LENGTH = 4096;

/** The session must be the caller's and still active; `pty.query` never touches
 * an ended session (its pty is gone). */
async function requireQueryableSession(
	context: Context & { authedUser: { id: string } },
	sessionId: string
): Promise<PtySessionRow> {
	const session = await context.services.stores.ptySession.getById(
		sessionId,
		context.authedUser.id
	);
	if (!session) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found" });
	}
	if (session.status !== "active") {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "This session has ended — its terminal is no longer running.",
		});
	}
	return session;
}

/** A project session queries the checkout; a project-less session queries the
 * CLI's home dir (`""`, resolved client-side). A named-but-not-ready project is
 * a precondition failure, mirroring the project loop's readiness gate. */
async function resolveWorkspaceRoot(
	context: Context & { authedUser: { id: string } },
	session: PtySessionRow
): Promise<string> {
	if (!session.projectId) {
		return "";
	}
	const project: ProjectRow | null =
		await context.services.stores.project.getById(
			session.projectId,
			context.authedUser.id
		);
	if (!(project && project.status === "ready" && project.localPath)) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message:
				"The project checkout isn't ready — wait for the clone to finish.",
		});
	}
	return project.localPath;
}

/** Per-op input shape: `path` is fs_list-only and must stay inside the
 * workspace; `cmd` is shell-only and required. Same first-gate philosophy as
 * the project loop — the CLI re-checks paths at realpath level. */
function requireQueryableInput(input: {
	cmd?: string;
	op: "fs_list" | "git_status" | "shell";
	path?: string;
}): void {
	if (input.path !== undefined) {
		if (input.op !== "fs_list") {
			throw new ORPCError("BAD_REQUEST", {
				message: "path only applies to fs_list",
			});
		}
		if (!isSafeRelativePath(input.path)) {
			throw new ORPCError("BAD_REQUEST", {
				message: "path must be relative and stay inside the workspace",
			});
		}
	}
	if (input.op === "shell" && !input.cmd?.trim()) {
		throw new ORPCError("BAD_REQUEST", {
			message: "shell queries need a command",
		});
	}
	if (input.cmd !== undefined && input.op !== "shell") {
		throw new ORPCError("BAD_REQUEST", {
			message: "cmd only applies to shell",
		});
	}
}

export const query = authorizedUserProcedure
	.input(
		z.object({
			cmd: z.string().max(SHELL_CMD_MAX_LENGTH).optional(),
			op: z.enum(["fs_list", "git_status", "shell"]),
			path: z.string().max(QUERY_PATH_MAX_LENGTH).optional(),
			sessionId: z.uuid(),
		})
	)
	.handler(async ({ input, context }) => {
		requireQueryableInput(input);
		const session = await requireQueryableSession(context, input.sessionId);
		const workspaceRoot = await resolveWorkspaceRoot(context, session);
		const { projectQueries } = context.services.computerControl;
		const requestId = crypto.randomUUID();
		// Park BEFORE the push so a fast answer can never miss the map.
		const parked = projectQueries.park({
			computerId: session.computerId,
			requestId,
		});
		const sent = context.services.computerControl.sendWorkspaceQuery(
			session.computerId,
			{
				kind: "workspace_query",
				op: input.op,
				requestId,
				workspaceRoot,
				...(input.path === undefined ? {} : { path: input.path }),
				...(input.cmd === undefined ? {} : { cmd: input.cmd }),
			}
		);
		if (!sent) {
			projectQueries.cancel(requestId);
			throw new ORPCError("PRECONDITION_FAILED", {
				message: "Computer is not connected — reconnect it and retry",
			});
		}
		let outcome: Awaited<typeof parked>;
		try {
			outcome = await parked;
		} catch (error) {
			throw new ORPCError("TIMEOUT", {
				message:
					error instanceof Error
						? error.message
						: "The computer did not answer in time",
			});
		}
		if (!outcome.ok) {
			throw new ORPCError("BAD_REQUEST", { message: outcome.errorMessage });
		}
		return outcome.result;
	});

/** The workspace label + availability gate the panes render before querying —
 * so a non-ready/ended workspace explains itself instead of firing a doomed
 * query. `path` is the checkout dir for a project session, null for a
 * home-directory one; `reason` is non-null exactly when a query can't run yet
 * (offline still surfaces from the query attempt, mirroring the project cards). */
export const workspace = authorizedUserProcedure
	.input(z.object({ sessionId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const session = await context.services.stores.ptySession.getById(
			input.sessionId,
			context.authedUser.id
		);
		if (!session) {
			throw new ORPCError("NOT_FOUND", { message: "Session not found" });
		}
		if (session.status !== "active") {
			return {
				kind: "home" as const,
				path: null,
				reason: "This session has ended — its terminal is no longer running.",
			};
		}
		if (!session.projectId) {
			return { kind: "home" as const, path: null, reason: null };
		}
		const project = await context.services.stores.project.getById(
			session.projectId,
			context.authedUser.id
		);
		if (!(project && project.status === "ready" && project.localPath)) {
			return {
				kind: "project" as const,
				path: null,
				reason:
					"The project checkout isn't ready — wait for the clone to finish.",
			};
		}
		return {
			kind: "project" as const,
			path: project.localPath,
			reason: null,
		};
	});
