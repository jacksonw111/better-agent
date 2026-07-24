import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure, bridgeProcedure } from "../index";
import { bumpProfileVersion } from "../profile-version";
import { resolveProfileBundle } from "./profile-materialize";

// The profiles router (Phase 1, DP1): a user's server-side source of truth —
// coding standards + project templates — with a `version` that any write bumps
// so a CLI knows it must re-sync. Every procedure is owner-scoped: the store
// resolves the caller's own profile from `authedUser.id`, so a user can never
// read or mutate another's rows.

const standardIdInput = z.object({ standardId: z.uuid() });
const templateIdInput = z.object({ templateId: z.uuid() });

const scaffoldInput = z.object({
	dirs: z.array(z.string()),
	files: z.array(z.object({ content: z.string(), path: z.string() })),
});

const standardInput = z.object({
	body: z.string().min(1),
	enabled: z.boolean().optional(),
	sortOrder: z.number().int().optional(),
	title: z.string().min(1),
});

const templateInput = z.object({
	claudeMd: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	mcpServerIds: z.array(z.uuid()).optional(),
	name: z.string().min(1),
	scaffold: scaffoldInput.optional(),
});

// A user may only wire THEIR OWN MCP servers into a template — a foreign id
// would seed someone else's server (with that owner's stored auth header) into
// a project's `.mcp.json`. Non-owned or since-deleted ids are dropped rather
// than rejected, so a save never locks up over a stale link. Mirrors skills.ts.
async function filterOwnedMcpServerIds(
	context: Context,
	userId: string,
	mcpServerIds: string[]
): Promise<string[]> {
	if (mcpServerIds.length === 0) {
		return mcpServerIds;
	}
	const owned = new Set(
		(await context.services.stores.mcpServer.listByUser(userId)).map(
			(row) => row.id
		)
	);
	return mcpServerIds.filter((id) => owned.has(id));
}

const get = authorizedUserProcedure.handler(({ context }) =>
	context.services.stores.profile.getProfile(context.authedUser.id)
);

// P1-C: the read-only sync bundle a client CLI pulls. It is a `bridgeProcedure`
// — not `authorizedUserProcedure` — because the CLI authenticates to the server
// with its long-lived bridge token (`bt_…`), the SAME credential the memory MCP
// endpoint requires and the one the sync writes into the landed `.mcp.json`; the
// CLI never holds a web JWT. Owner scoping still holds: the bundle is resolved
// from the token's own `userId`, so a token only ever materializes its owner's
// Profile. Read-only — it never touches the P1-A write path.
const materializeBundle = bridgeProcedure.handler(({ context }) =>
	resolveProfileBundle(context, context.authedBridgeToken.userId)
);

const standardsRouter = {
	create: authorizedUserProcedure
		.input(standardInput)
		.handler(async ({ input, context }) => {
			const userId = context.authedUser.id;
			const created = await context.services.stores.profile.createStandard(
				userId,
				input
			);
			await bumpProfileVersion(context.services.stores.profile, userId);
			return created;
		}),

	update: authorizedUserProcedure
		.input(standardIdInput.extend(standardInput.partial().shape))
		.handler(async ({ input, context }) => {
			const { standardId, ...patch } = input;
			const userId = context.authedUser.id;
			const updated = await context.services.stores.profile.updateStandard(
				userId,
				standardId,
				patch
			);
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Standard not found" });
			}
			await bumpProfileVersion(context.services.stores.profile, userId);
			return updated;
		}),

	delete: authorizedUserProcedure
		.input(standardIdInput)
		.handler(async ({ input, context }) => {
			const userId = context.authedUser.id;
			await context.services.stores.profile.deleteStandard(
				userId,
				input.standardId
			);
			await bumpProfileVersion(context.services.stores.profile, userId);
			return { ok: true };
		}),

	reorder: authorizedUserProcedure
		.input(z.object({ orderedIds: z.array(z.uuid()) }))
		.handler(async ({ input, context }) => {
			const userId = context.authedUser.id;
			await context.services.stores.profile.reorderStandards(
				userId,
				input.orderedIds
			);
			await bumpProfileVersion(context.services.stores.profile, userId);
			return { ok: true };
		}),
};

const templatesRouter = {
	create: authorizedUserProcedure
		.input(templateInput)
		.handler(async ({ input, context }) => {
			const userId = context.authedUser.id;
			const mcpServerIds =
				input.mcpServerIds === undefined
					? undefined
					: await filterOwnedMcpServerIds(context, userId, input.mcpServerIds);
			const created = await context.services.stores.profile.createTemplate(
				userId,
				{ ...input, mcpServerIds }
			);
			await bumpProfileVersion(context.services.stores.profile, userId);
			return created;
		}),

	update: authorizedUserProcedure
		.input(templateIdInput.extend(templateInput.partial().shape))
		.handler(async ({ input, context }) => {
			const { templateId, ...patch } = input;
			const userId = context.authedUser.id;
			if (patch.mcpServerIds !== undefined) {
				patch.mcpServerIds = await filterOwnedMcpServerIds(
					context,
					userId,
					patch.mcpServerIds
				);
			}
			const updated = await context.services.stores.profile.updateTemplate(
				userId,
				templateId,
				patch
			);
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Template not found" });
			}
			await bumpProfileVersion(context.services.stores.profile, userId);
			return updated;
		}),

	delete: authorizedUserProcedure
		.input(templateIdInput)
		.handler(async ({ input, context }) => {
			const userId = context.authedUser.id;
			await context.services.stores.profile.deleteTemplate(
				userId,
				input.templateId
			);
			await bumpProfileVersion(context.services.stores.profile, userId);
			return { ok: true };
		}),
};

export const profilesRouter = {
	get,
	materializeBundle,
	standards: standardsRouter,
	templates: templatesRouter,
};
