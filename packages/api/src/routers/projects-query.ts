import {
	PROJECT_FS_LIST_MAX_ENTRIES,
	type ProjectQueryOutcome,
	type ProjectRow,
} from "@better-agent/agent/project-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure, computerProcedure } from "../index";

// Q2: the read-only project query loop. `query` (user plane) parks a
// requestId, pushes a `project_query` frame over the computer control WS and
// waits; the CLI executes the read-only op inside the project checkout and
// answers through `submitQueryResult` (computer plane), which wakes the
// parked call. Pure real-time by design — the frame never enters the
// pendingCommands persistent queue: a Computer without a live control socket
// fails fast with PRECONDITION_FAILED, and an unanswered query times out
// (PROJECT_QUERY_TIMEOUT_MS) instead of lingering. Split out of projects.ts
// for the repo's 300-line cap (same precedent as bridge-pending-requests.ts).

const QUERY_PATH_MAX_LENGTH = 1024;
const PATH_SEPARATORS = /[/\\]/;

/** fs_list paths are project-relative by contract: no absolute paths, no
 * `..` segments (checked on both separators so `..\` can't slip through on a
 * Windows computer). The CLI re-checks with realpath-level confinement
 * (workspace-path.ts) — this is the cheap server-side first gate. */
function isSafeRelativePath(path: string): boolean {
	if (path.startsWith("/") || path.startsWith("\\")) {
		return false;
	}
	return !path
		.split(PATH_SEPARATORS)
		.some((segment) => segment === ".." || segment.includes("\0"));
}

function requireQueryablePath(
	op: "fs_list" | "git_status",
	path: string | undefined
): void {
	if (path === undefined) {
		return;
	}
	if (op !== "fs_list") {
		throw new ORPCError("BAD_REQUEST", {
			message: "path only applies to fs_list",
		});
	}
	if (!isSafeRelativePath(path)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "path must be relative and stay inside the project",
		});
	}
}

async function requireQueryableProject(
	context: Context & { authedUser: { id: string } },
	projectId: string
): Promise<ProjectRow> {
	const project = await context.services.stores.project.getById(
		projectId,
		context.authedUser.id
	);
	if (!project) {
		throw new ORPCError("NOT_FOUND", { message: "Project not found" });
	}
	if (project.status !== "ready") {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "Project is not ready — wait for the clone to finish",
		});
	}
	return project;
}

async function awaitOutcome(
	parked: Promise<ProjectQueryOutcome>
): Promise<ProjectQueryOutcome> {
	try {
		return await parked;
	} catch (error) {
		throw new ORPCError("TIMEOUT", {
			message:
				error instanceof Error
					? error.message
					: "The computer did not answer in time",
		});
	}
}

export const query = authorizedUserProcedure
	.input(
		z.object({
			op: z.enum(["fs_list", "git_status"]),
			path: z.string().max(QUERY_PATH_MAX_LENGTH).optional(),
			projectId: z.uuid(),
		})
	)
	.handler(async ({ input, context }) => {
		requireQueryablePath(input.op, input.path);
		const project = await requireQueryableProject(context, input.projectId);
		const { projectQueries } = context.services.computerControl;
		const requestId = crypto.randomUUID();
		// Park BEFORE the push so a fast answer can never miss the map.
		const parked = projectQueries.park({
			computerId: project.computerId,
			requestId,
		});
		const sent = context.services.computerControl.sendProjectQuery(
			project.computerId,
			{
				kind: "project_query",
				op: input.op,
				projectId: project.id,
				requestId,
				...(input.path === undefined ? {} : { path: input.path }),
			}
		);
		if (!sent) {
			projectQueries.cancel(requestId);
			throw new ORPCError("PRECONDITION_FAILED", {
				message: "Computer is not connected — reconnect it and retry",
			});
		}
		const outcome = await awaitOutcome(parked);
		if (!outcome.ok) {
			// The CLI's execution error, verbatim (path escape, git failure, …).
			throw new ORPCError("BAD_REQUEST", { message: outcome.errorMessage });
		}
		return outcome.result;
	});

const FS_LIST_RESULT = z.object({
	entries: z
		.array(
			z.object({
				kind: z.enum(["file", "dir"]),
				name: z.string(),
				size: z.number().optional(),
			})
		)
		.max(PROJECT_FS_LIST_MAX_ENTRIES),
});

const GIT_STATUS_RESULT = z.object({
	branch: z.string().nullable(),
	changes: z.array(z.object({ path: z.string(), status: z.string() })),
	dirty: z.boolean(),
	lastCommit: z.object({ hash: z.string(), subject: z.string() }).nullable(),
});

// The Computer's answer for one parked query. A late (post-timeout) or
// duplicate submit — and one naming a request another computer owns — is an
// idempotent ok:false, never an error (no oracle across computers).
export const submitQueryResult = computerProcedure
	.input(
		z.discriminatedUnion("ok", [
			z.object({
				ok: z.literal(true),
				requestId: z.uuid(),
				result: z.union([FS_LIST_RESULT, GIT_STATUS_RESULT]),
			}),
			z.object({
				errorMessage: z.string().min(1),
				ok: z.literal(false),
				requestId: z.uuid(),
			}),
		])
	)
	.handler(({ input, context }) => {
		const delivered = context.services.computerControl.projectQueries.resolve(
			input.requestId,
			context.computer.id,
			input.ok
				? { ok: true, result: input.result }
				: { errorMessage: input.errorMessage, ok: false }
		);
		return { ok: delivered };
	});
