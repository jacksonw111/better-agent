import type {
	ProjectEditUpdate,
	ProjectRow,
} from "@better-agent/agent/project-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import {
	hasVisibleText,
	isValidGitUrl,
	NAME_MAX_LENGTH,
	repoDisplayName,
	TOKEN_LAST4,
	toListedProject,
} from "./projects-shared";
import {
	notifyComputerBestEffort,
	requireOnlineOwnedComputer,
} from "./tasks-guards";

// The user-plane Project edits (projects.update / projects.retryClone). A
// rename touches only the display name; a repo or token change re-encrypts /
// re-derives AND resets the row to `created` — which, under D4's "queue IS
// the state", is all it takes to re-enter the clone-delivery queue. Both
// re-queues need the computer online (same gate as create) and end with the
// same best-effort WS notify; heartbeat pendingCommands stays the guarantee.
//
// Known limitation: the CLI's clone idempotency short-circuit re-reports
// `ready` whenever the derived checkout directory already exists and is a git
// repository. After a repoUrl edit that keeps the repo SHORT NAME (the
// directory suffix) unchanged, a leftover checkout of the OLD remote would be
// re-reported ready without recloning. Accepted for now: the primary edit
// scenario is fixing a FAILED clone, where no checkout directory exists yet.

type Services = Context["services"];

const UPDATE_INPUT = z
	.object({
		name: z
			.string()
			.max(NAME_MAX_LENGTH)
			.refine(hasVisibleText, "Project name is required")
			.optional(),
		projectId: z.uuid(),
		repoUrl: z
			.string()
			.refine(isValidGitUrl, {
				message: "Git URL must be https://… or git@host:path.git",
			})
			.optional(),
		token: z.string().min(1).optional(),
	})
	.refine(
		(value) =>
			value.name !== undefined ||
			value.repoUrl !== undefined ||
			value.token !== undefined,
		{ message: "Nothing to update", path: ["name"] }
	);

type UpdateInput = z.infer<typeof UPDATE_INPUT>;

/** The store patch for one edit. `reclone` is true when the repo or token
 * changed — those edits invalidate the existing checkout, so the clone state
 * resets to `created` (errorMessage/localPath cleared) for re-delivery. */
function buildEditPatch(
	services: Services,
	input: UpdateInput
): { patch: ProjectEditUpdate; reclone: boolean } {
	const patch: ProjectEditUpdate = {};
	if (input.name !== undefined) {
		patch.name = input.name;
	}
	if (input.repoUrl !== undefined) {
		patch.repoCloneUrl = input.repoUrl;
		patch.repoFullName = repoDisplayName(input.repoUrl);
	}
	if (input.token !== undefined) {
		patch.encryptedToken = services.secretBox.encrypt(input.token);
		patch.tokenLast4 = input.token.slice(-TOKEN_LAST4);
	}
	const reclone = input.repoUrl !== undefined || input.token !== undefined;
	if (reclone) {
		patch.errorMessage = null;
		patch.localPath = null;
		patch.status = "created";
	}
	return { patch, reclone };
}

/** Owner-scoped read shared by both edits — unknown and foreign look
 * identical (no oracle), same as every other project read. */
async function requireOwnedProject(
	services: Services,
	userId: string,
	projectId: string
): Promise<ProjectRow> {
	const project = await services.stores.project.getById(projectId, userId);
	if (!project) {
		throw new ORPCError("NOT_FOUND", { message: "Project not found" });
	}
	return project;
}

/** Applies the patch and, for a re-clone, performs the same online gate +
 * best-effort notify as create — the row is already back in the queue. */
async function applyEdit(
	services: Services,
	project: ProjectRow,
	edit: { patch: ProjectEditUpdate; reclone: boolean }
) {
	if (edit.reclone) {
		await requireOnlineOwnedComputer(
			services,
			project.userId,
			project.computerId
		);
	}
	const updated = await services.stores.project.update(
		project.id,
		project.userId,
		edit.patch
	);
	if (!updated) {
		throw new ORPCError("NOT_FOUND", { message: "Project not found" });
	}
	if (edit.reclone) {
		await notifyComputerBestEffort(services, project.computerId);
	}
	return toListedProject(updated);
}

export const update = authorizedUserProcedure
	.input(UPDATE_INPUT)
	.handler(async ({ input, context }) => {
		const { services } = context;
		const project = await requireOwnedProject(
			services,
			context.authedUser.id,
			input.projectId
		);
		return await applyEdit(services, project, buildEditPatch(services, input));
	});

/** error → created: the explicit re-queue for a failed clone. ready/cloning/
 * created have nothing to retry — the state either works or is in flight. */
export const retryClone = authorizedUserProcedure
	.input(z.object({ projectId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const { services } = context;
		const project = await requireOwnedProject(
			services,
			context.authedUser.id,
			input.projectId
		);
		if (project.status !== "error") {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: "Only a failed clone can be retried",
			});
		}
		return await applyEdit(services, project, {
			patch: { errorMessage: null, status: "created" },
			reclone: true,
		});
	});
