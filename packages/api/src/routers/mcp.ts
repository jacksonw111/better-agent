import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";

const serverIdInput = z.object({ serverId: z.uuid() });
const MAX_DETAIL_LEN = 300;
const MAX_DETAIL_DEPTH = 4;

function detailOf(error: unknown, depth = 0): string {
	if (depth > MAX_DETAIL_DEPTH || !(error instanceof Error)) {
		return "";
	}
	const rest = error.cause ? detailOf(error.cause, depth + 1) : "";
	return rest ? `${error.message} — ${rest}` : error.message;
}

function toMcpError(error: unknown): ORPCError<string, undefined> {
	const detail = detailOf(error) || "unknown error";
	return new ORPCError("BAD_REQUEST", {
		message: `MCP request failed: ${detail.slice(0, MAX_DETAIL_LEN)}`,
	});
}

async function callMcp<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		throw toMcpError(error);
	}
}

// Asserts the server exists AND belongs to the caller. NOT_FOUND for both
// missing and other-owner servers, so ownership never leaks.
async function requireOwnedMcpServer(
	context: Context,
	userId: string,
	serverId: string
) {
	const server = await context.services.stores.mcpServer.getById(serverId);
	if (!server || server.userId !== userId) {
		throw new ORPCError("NOT_FOUND", { message: "MCP server not found" });
	}
	return server;
}

// A raw bearer token, as typed by the owner, mapped to the Authorization
// header value the mcpServer store persists. `null`/`undefined` pass through
// unchanged so callers can distinguish "no token" from "leave it as-is".
function mapBearerToken<T extends string | null | undefined>(
	bearerToken: T
): T extends string ? string : T {
	return (
		bearerToken ? `Bearer ${bearerToken}` : bearerToken
	) as T extends string ? string : T;
}

async function createOwnedServer(
	context: Context,
	userId: string,
	input: { name: string; url: string; bearerToken?: string }
) {
	const server = await context.services.stores.mcpServer.create({
		name: input.name,
		url: input.url,
		authHeader: mapBearerToken(input.bearerToken),
		userId,
	});
	// Validate by connecting + listing tools; roll back a bad config so the
	// owner gets immediate feedback instead of a silently broken server.
	try {
		const service = await context.services.mcp(server.id);
		await service?.listTools();
	} catch (error) {
		await context.services.stores.mcpServer.delete(server.id);
		throw toMcpError(error);
	}
	await context.services.stores.activity.log({
		userId,
		type: "mcp_server_added",
		summary: `Added MCP server “${server.name}”`,
	});
	return server;
}

// Per-user remote MCP servers (e.g. X's hosted MCP): each user registers their
// own URL + credentials; only their agents can link them.
export const mcpRouter = {
	listServers: authorizedUserProcedure.handler(({ context }) =>
		context.services.stores.mcpServer.listByUser(context.authedUser.id)
	),

	createServer: authorizedUserProcedure
		.input(
			z.object({
				name: z.string().min(1),
				url: z.url(),
				bearerToken: z.string().min(1).optional(),
			})
		)
		.handler(({ input, context }) =>
			createOwnedServer(context, context.authedUser.id, input)
		),

	updateServer: authorizedUserProcedure
		.input(
			z.object({
				serverId: z.uuid(),
				name: z.string().min(1).optional(),
				url: z.url().optional(),
				// undefined = leave the stored token as-is; null = clear it;
				// a string = replace it.
				bearerToken: z.string().min(1).nullable().optional(),
			})
		)
		.handler(async ({ input, context }) => {
			await requireOwnedMcpServer(
				context,
				context.authedUser.id,
				input.serverId
			);
			const updated = await context.services.stores.mcpServer.update(
				input.serverId,
				{
					name: input.name,
					url: input.url,
					authHeader: mapBearerToken(input.bearerToken),
				}
			);
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "MCP server not found" });
			}
			await context.services.stores.activity.log({
				userId: context.authedUser.id,
				type: "mcp_server_updated",
				summary: `Updated MCP server “${updated.name}”`,
			});
			return updated;
		}),

	deleteServer: authorizedUserProcedure
		.input(serverIdInput)
		.handler(async ({ input, context }) => {
			const server = await requireOwnedMcpServer(
				context,
				context.authedUser.id,
				input.serverId
			);
			await context.services.stores.mcpServer.delete(input.serverId);
			// Cascade: drop this server from every agent that linked it.
			await context.services.stores.agent.unlinkMcpServer(
				context.authedUser.id,
				input.serverId
			);
			await context.services.stores.activity.log({
				userId: context.authedUser.id,
				type: "mcp_server_removed",
				summary: `Removed MCP server “${server.name}”`,
			});
			return { ok: true };
		}),

	// Diagnostic: the live tool list this server yields (errors SURFACED).
	tools: authorizedUserProcedure
		.input(serverIdInput)
		.handler(async ({ input, context }) => {
			await requireOwnedMcpServer(
				context,
				context.authedUser.id,
				input.serverId
			);
			return callMcp(async () => {
				const service = await context.services.mcp(input.serverId);
				const tools = (await service?.listTools()) ?? [];
				return tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
				}));
			});
		}),
};
