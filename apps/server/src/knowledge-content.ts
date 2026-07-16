import { createContext } from "@better-agent/api/context";
import type { AgentServices } from "@better-agent/api/services";
import type { EvlogVariables } from "evlog/hono";
import type { Hono } from "hono";

// Authed streaming reads for Knowledge Base documents. A plain Hono route
// (not an oRPC procedure) so <img>, <iframe> and react-pdf can load documents
// progressively straight off R2 — no whole-file buffering, no client-side
// size cap. Auth mirrors the RPC plane: bearer header or ?access_token=
// (createContext resolves both), then owner scoping inside the store.

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function applyKnowledgeContentRoute(
	app: Hono<EvlogVariables>,
	services: AgentServices
): void {
	app.get("/knowledge/:id/content", async (c) => {
		const context = await createContext({ context: c, services });
		const user = context.authedUser;
		if (!user || user.blocked) {
			return c.text("Unauthorized", HTTP_UNAUTHORIZED);
		}
		const id = c.req.param("id");
		if (!UUID_RE.test(id)) {
			return c.text("Not Found", HTTP_NOT_FOUND);
		}
		let content: Awaited<
			ReturnType<typeof services.stores.knowledge.getContent>
		>;
		try {
			content = await services.stores.knowledge.getContent(user.id, id);
		} catch (error) {
			if (error instanceof Error && error.message.includes("unavailable")) {
				return c.text("Document storage is not configured", HTTP_UNAVAILABLE);
			}
			throw error;
		}
		if (!content) {
			return c.text("Not Found", HTTP_NOT_FOUND);
		}
		const { body, document } = content;
		const disposition =
			c.req.query("download") === "1" ? "attachment" : "inline";
		return new Response(body, {
			headers: {
				"content-type": document.mime,
				"content-length": String(document.size),
				// RFC 5987 filename* so non-ASCII document names survive downloads.
				"content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(document.name)}`,
				"cache-control": "private, no-store",
			},
		});
	});
}
