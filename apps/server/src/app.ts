import { createContext } from "@better-agent/api/context";
import { appRouter } from "@better-agent/api/routers/index";
import { env } from "@better-agent/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { log } from "evlog";
import { type EvlogVariables, evlog } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { applyKnowledgeContentRoute } from "./knowledge-content";
import { createPdfProxyHandler } from "./pdf-proxy";

// The PDF proxy streams multi-MB report bodies — like the streaming endpoints
// below it must skip the buffering log middleware, both to avoid locking the
// body and so a large PDF is never held in memory just to be logged.
const PDF_PROXY_PATH = "/pdf-proxy";

// Streaming (event-iterator) endpoints must skip the logging middleware: it
// buffers the response, which locks the body stream and makes the streamed
// response throw "ReadableStream is locked". The agent plane
// (sessions/prompt) and the user/web plane (userSessions/prompt) stream.
const STREAMING_PATHS = new Set([
	"/rpc/sessions/prompt",
	"/rpc/userSessions/prompt",
]);

function isStreamingPath(path: string): boolean {
	return path === PDF_PROXY_PATH || STREAMING_PATHS.has(path);
}

const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_FORBIDDEN = 403;

const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			log.error({ error });
		}),
	],
});

const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			log.error({ error });
		}),
	],
});

export type AgentServices = Parameters<typeof createContext>[0]["services"];

function applyMiddleware(app: Hono<EvlogVariables>): void {
	const evlogMiddleware = evlog();
	app.use("/*", (c, next) =>
		isStreamingPath(c.req.path) ? next() : evlogMiddleware(c, next)
	);
	app.use(
		"/*",
		cors({ origin: env.CORS_ORIGIN, allowMethods: ["GET", "POST", "OPTIONS"] })
	);
	// The cors() middleware sets the allow-origin header AFTER the handler runs,
	// so a thrown error skips it — the browser masks the real 500 as a CORS
	// failure. Re-apply the header here so error responses stay readable.
	app.onError((error, c) => {
		const origin = c.req.header("origin");
		if (origin && env.CORS_ORIGIN.includes(origin)) {
			c.header("Access-Control-Allow-Origin", origin);
		}
		log.error({ error });
		return c.text("Internal Server Error", HTTP_INTERNAL_SERVER_ERROR);
	});
}

function applyRpcHandler(
	app: Hono<EvlogVariables>,
	services: AgentServices
): void {
	// Return the handler's Response directly. Re-wrapping via
	// c.newResponse(response.body, response) attaches a second reader to the
	// same body stream, throwing "ReadableStream is locked" for streaming
	// responses (e.g. sessions.prompt).
	app.use("/*", async (c, next) => {
		const context = await createContext({ context: c, services });
		const rpcResult = await rpcHandler.handle(c.req.raw, {
			prefix: "/rpc",
			context,
		});
		if (rpcResult.matched) {
			return rpcResult.response;
		}
		const apiResult = await apiHandler.handle(c.req.raw, {
			prefix: "/api-reference",
			context,
		});
		if (apiResult.matched) {
			return apiResult.response;
		}
		return await next();
	});
}

// Internal endpoint the authz service calls (with the shared service secret) to
// drop cached authorizations immediately when an invite code is revoked.
function applyInternalRoutes(
	app: Hono<EvlogVariables>,
	services: AgentServices
): void {
	app.post("/internal/authz-invalidate", async (c) => {
		const secret = env.AUTHZ_SERVICE_SECRET;
		if (!secret || c.req.header("x-service-secret") !== secret) {
			return c.text("forbidden", HTTP_FORBIDDEN);
		}
		const body = (await c.req.json().catch(() => ({}))) as {
			subjects?: unknown;
		};
		const subjects = Array.isArray(body.subjects)
			? body.subjects.filter((s): s is string => typeof s === "string")
			: [];
		await services.stores.webAuthzCache.clear(subjects);
		return c.json({ ok: true });
	});
}

// Public, host-allow-listed proxy for report/research PDFs. Registered before
// the oRPC catch-all so it terminates here without paying an oRPC dispatch.
function applyPdfProxyRoute(app: Hono<EvlogVariables>): void {
	app.get(PDF_PROXY_PATH, createPdfProxyHandler(fetch));
}

export function buildApp(services: AgentServices): Hono<EvlogVariables> {
	const app = new Hono<EvlogVariables>();
	applyMiddleware(app);
	applyKnowledgeContentRoute(app, services);
	applyPdfProxyRoute(app);
	applyInternalRoutes(app, services);
	applyRpcHandler(app, services);
	app.get("/", (c) => c.text("OK"));
	return app;
}
