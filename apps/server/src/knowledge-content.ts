import { KNOWLEDGE_PART_SIZE } from "@better-agent/agent/knowledge-ports";
import { createContext } from "@better-agent/api/context";
import type { AgentServices } from "@better-agent/api/services";
import type { EvlogVariables } from "evlog/hono";
import type { Hono, Context as HonoRequestContext } from "hono";

// Authed HTTP routes for Knowledge Base documents — plain Hono, not oRPC:
// - GET  …/content pipes bytes progressively straight off R2, so <img>,
//   <iframe> and react-pdf can stream without a client-side size cap.
// - POST …/parts/:n takes one raw chunk body, so the browser can upload via
//   XMLHttpRequest and get byte-level upload.onprogress (fetch/oRPC can't
//   report upload progress, which made the bar jump 0→100).
// Auth mirrors the RPC plane: bearer header or ?access_token= (createContext
// resolves both), then owner scoping inside the store.

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;
// Matches the RPC router's MAX_PART_NUMBER (S3 multipart hard cap).
const MAX_PART_NUMBER = 10_000;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUser(c: HonoRequestContext, services: AgentServices) {
	const context = await createContext({ context: c, services });
	const user = context.authedUser;
	return user && !user.blocked ? user : null;
}

function isStorageUnavailable(error: unknown): boolean {
	return error instanceof Error && error.message.includes("unavailable");
}

function applyContentRoute(
	app: Hono<EvlogVariables>,
	services: AgentServices
): void {
	app.get("/knowledge/:id/content", async (c) => {
		const user = await requireUser(c, services);
		if (!user) {
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
			if (isStorageUnavailable(error)) {
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

function parsePartNumber(raw: string): number | null {
	const part = Number(raw);
	if (!Number.isInteger(part) || part < 1 || part > MAX_PART_NUMBER) {
		return null;
	}
	return part;
}

function applyPartRoute(
	app: Hono<EvlogVariables>,
	services: AgentServices
): void {
	app.post("/knowledge/:id/parts/:partNumber", async (c) => {
		const user = await requireUser(c, services);
		if (!user) {
			return c.text("Unauthorized", HTTP_UNAUTHORIZED);
		}
		const id = c.req.param("id");
		const partNumber = parsePartNumber(c.req.param("partNumber"));
		if (!(UUID_RE.test(id) && partNumber !== null)) {
			return c.text("Not Found", HTTP_NOT_FOUND);
		}
		const data = new Uint8Array(await c.req.arrayBuffer());
		if (data.byteLength < 1 || data.byteLength > KNOWLEDGE_PART_SIZE) {
			return c.text(
				`Chunk must be 1..${KNOWLEDGE_PART_SIZE} bytes`,
				HTTP_BAD_REQUEST
			);
		}
		let stored: boolean;
		try {
			stored = await services.stores.knowledge.uploadPart({
				ownerId: user.id,
				documentId: id,
				partNumber,
				data,
			});
		} catch (error) {
			if (isStorageUnavailable(error)) {
				return c.text("Document storage is not configured", HTTP_UNAVAILABLE);
			}
			throw error;
		}
		if (!stored) {
			return c.text("Not Found", HTTP_NOT_FOUND);
		}
		return c.json({ ok: true });
	});
}

export function applyKnowledgeContentRoute(
	app: Hono<EvlogVariables>,
	services: AgentServices
): void {
	applyContentRoute(app, services);
	applyPartRoute(app, services);
}
