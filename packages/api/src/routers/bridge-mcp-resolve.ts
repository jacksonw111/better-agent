import type { Context } from "../context";

// R5-a: resolves a bridge token's assigned `config.mcpServerIds` into
// connection-ready servers, shared by `startSession` (bridge.ts) and
// `fetchConfig` (bridge-restart.ts). Split into its own file so neither host
// file grows past the repo's 300-line cap.

/** A registered MCP server resolved to what the CLI needs to connect to it:
 * `headers` carries the server's decrypted auth header (a secret) already
 * formatted as an `Authorization` header, so this must only ever be computed
 * server-side and handed to the CLI over the authed bridge-token channel —
 * never re-derived from a bare server id on the client. Applying these to the
 * launched agent process is R5-b, not this task. */
export interface ResolvedMcpServer {
	headers: Record<string, string>;
	name: string;
	url: string;
}

async function resolveOne(
	context: Context,
	userId: string,
	id: string
): Promise<ResolvedMcpServer | null> {
	const server = await context.services.stores.mcpServer.getById(id);
	// Owner-scoped: an id for another user's server (or one that's since been
	// deleted) is silently skipped, not surfaced as an error — a token's
	// persisted config can outlive the server it references.
	if (!server || server.userId !== userId) {
		return null;
	}
	const authHeader = await context.services.stores.mcpServer.getAuthHeader(id);
	return {
		headers: authHeader ? { Authorization: authHeader } : {},
		name: server.name,
		url: server.url,
	};
}

/** Resolves `mcpServerIds` (in order, deduped ids only implicitly via the
 * source array) into `ResolvedMcpServer`s, owner-scoped to `userId`. Returns
 * `[]` for an empty/absent list rather than short-circuiting the caller. */
export async function resolveMcpServers(
	context: Context,
	userId: string,
	mcpServerIds: string[] | undefined
): Promise<ResolvedMcpServer[]> {
	if (!mcpServerIds || mcpServerIds.length === 0) {
		return [];
	}
	const resolved = await Promise.all(
		mcpServerIds.map((id) => resolveOne(context, userId, id))
	);
	return resolved.filter(
		(server): server is ResolvedMcpServer => server !== null
	);
}
