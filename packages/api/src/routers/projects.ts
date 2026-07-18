import type { ProjectRow } from "@better-agent/agent/project-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { authorizedUserProcedure, computerProcedure } from "../index";
import {
	notifyComputerBestEffort,
	requireOnlineOwnedComputer,
} from "./tasks-guards";

// Projects router (Q1): a Project is a long-lived checkout of one GitHub
// repository on one Computer — cloned once into a fixed directory, shared as
// the cwd by every session started against it. Creation queues the clone via
// the same "queue IS the state" delivery as Launch Commands (D4): a
// still-`created` row renders as a pending `clone_project` command on both
// the /computer-ws push and heartbeat pendingCommands; the client acks
// (ackClone → cloning), clones, then reports the result (reportCloneResult →
// ready+localPath / error+errorMessage).
//
// Token boundary: the optional `token` is a repository credential the user
// EXPLICITLY configures for this Computer. It rests only as secret-box
// ciphertext, and is decrypted exactly once — into the clone command sent to
// the user's own machine for git auth. That delivery is an intentional
// product decision; it is distinct from the server-side GitHub Connection,
// whose token still never leaves the server. No response from this router
// ever carries a token — list/get expose tokenLast4 alone.

const NAME_MAX_LENGTH = 120;
const TOKEN_LAST4 = 4;
const REPO_FULL_NAME_PATTERN = /^[^/\s]+\/[^/\s]+$/;

const hasVisibleText = (value: string) => value.trim().length > 0;

/** Explicit field list so `encryptedToken` can never leak into a user-facing
 * response by accident — the credential surface is tokenLast4 only. */
function toListedProject(row: ProjectRow) {
	return {
		computerId: row.computerId,
		createdAt: row.createdAt,
		errorMessage: row.errorMessage,
		id: row.id,
		localPath: row.localPath,
		name: row.name,
		repoCloneUrl: row.repoCloneUrl,
		repoFullName: row.repoFullName,
		status: row.status,
		tokenLast4: row.tokenLast4,
		updatedAt: row.updatedAt,
	};
}

const create = authorizedUserProcedure
	.input(
		z.object({
			computerId: z.uuid(),
			name: z
				.string()
				.max(NAME_MAX_LENGTH)
				.refine(hasVisibleText, "Project name is required"),
			// Defaults to the https URL derived from repoFullName when omitted.
			repoCloneUrl: z.url().optional(),
			repoFullName: z.string().regex(REPO_FULL_NAME_PATTERN, {
				message: "Repository must be owner/repo",
			}),
			token: z.string().min(1).optional(),
		})
	)
	.handler(async ({ input, context }) => {
		const { services } = context;
		// Same gate as Task Start (§8.5): the computer must be the caller's and
		// currently connected — a clone can't be queued for an offline machine.
		const computer = await requireOnlineOwnedComputer(
			services,
			context.authedUser.id,
			input.computerId
		);
		const project = await services.stores.project.insert({
			computerId: computer.id,
			encryptedToken: input.token
				? services.secretBox.encrypt(input.token)
				: null,
			name: input.name,
			repoCloneUrl:
				input.repoCloneUrl ?? `https://github.com/${input.repoFullName}.git`,
			repoFullName: input.repoFullName,
			tokenLast4: input.token ? input.token.slice(-TOKEN_LAST4) : null,
			userId: context.authedUser.id,
		});
		// The row is `created`, i.e. already in the delivery queue — the push is
		// best-effort; heartbeat pendingCommands is the delivery guarantee (D4).
		await notifyComputerBestEffort(services, computer.id);
		return toListedProject(project);
	});

const list = authorizedUserProcedure
	.input(z.object({ computerId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const rows = await context.services.stores.project.listByComputer(
			context.authedUser.id,
			input.computerId
		);
		return rows.map(toListedProject);
	});

const get = authorizedUserProcedure
	.input(z.object({ projectId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const project = await context.services.stores.project.getById(
			input.projectId,
			context.authedUser.id
		);
		if (!project) {
			throw new ORPCError("NOT_FOUND", { message: "Project not found" });
		}
		return toListedProject(project);
	});

// Removes the Project row ONLY. The checkout directory on the Computer
// (~/.better-agent/projects/…) is the user's local data — the server never
// deletes it; reclaiming disk space is a manual (or future CLI) action.
const deleteProject = authorizedUserProcedure
	.input(z.object({ projectId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const deleted = await context.services.stores.project.delete(
			input.projectId,
			context.authedUser.id
		);
		if (!deleted) {
			throw new ORPCError("NOT_FOUND", { message: "Project not found" });
		}
		return { ok: true };
	});

// The client's ack for a delivered clone command — same oRPC path whether the
// command arrived over /computer-ws or heartbeat pendingCommands. Flipping
// created→cloning removes the Project from the pending queue, which is what
// makes redelivery idempotent (projectId is the idempotency key).
const ackClone = computerProcedure
	.input(z.object({ projectId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const project = await context.services.stores.project.getByIdForComputer(
			input.projectId,
			context.computer.id
		);
		// Unknown AND someone-else's-computer look identical — no oracle.
		if (!project) {
			throw new ORPCError("NOT_FOUND", { message: "Project not found" });
		}
		// Already past `created` (a duplicate ack after redelivery): idempotent
		// ok:false, never an error — the client just skips the clone.
		if (project.status !== "created") {
			return { ok: false };
		}
		await context.services.stores.project.updateStatus(project.id, {
			status: "cloning",
		});
		return { ok: true };
	});

const REPORT_INPUT = z.discriminatedUnion("status", [
	z.object({
		// The client-generated absolute checkout path
		// (~/.better-agent/projects/<projectId 前8>-<repo 短名>/) — the server
		// records it verbatim, never derives it.
		localPath: z.string().min(1),
		projectId: z.uuid(),
		status: z.literal("ready"),
	}),
	z.object({
		// The REAL clone failure — recorded verbatim, never synthesized.
		errorMessage: z.string().min(1),
		projectId: z.uuid(),
		status: z.literal("error"),
	}),
]);

// The clone outcome. Accepted from `created` too (not just `cloning`): a lost
// ack must not strand a finished clone. ready/error are terminal — a repeat
// or late report is an idempotent ok:false, never an error.
const reportCloneResult = computerProcedure
	.input(REPORT_INPUT)
	.handler(async ({ input, context }) => {
		const project = await context.services.stores.project.getByIdForComputer(
			input.projectId,
			context.computer.id
		);
		if (!project) {
			throw new ORPCError("NOT_FOUND", { message: "Project not found" });
		}
		if (project.status === "ready" || project.status === "error") {
			return { ok: false };
		}
		await context.services.stores.project.updateStatus(
			project.id,
			input.status === "ready"
				? { localPath: input.localPath, status: "ready" }
				: { errorMessage: input.errorMessage, status: "error" }
		);
		return { ok: true };
	});

export const projectsRouter = {
	ackClone,
	create,
	delete: deleteProject,
	get,
	list,
	reportCloneResult,
};
