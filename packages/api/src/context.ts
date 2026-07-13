import type { AgentConfig } from "@better-agent/agent/agent/types";
import type { User } from "@better-agent/agent/auth/types";
import { hashToken } from "@better-agent/agent/crypto/auth-tokens";
import type { Context as HonoContext } from "hono";
import type { AgentServices } from "./services";

export interface CreateContextOptions {
	context: HonoContext;
	services: AgentServices;
}

/** The bridge token resolved from a `bt_…` bearer credential. */
export interface AuthedBridgeToken {
	tokenId: string;
	userId: string;
}

const BEARER_PREFIX = "Bearer ";
// A JWT is three dot-separated segments (header.payload.signature); agent
// tokens are `ba_<base64url>` and never contain a dot; bridge tokens are
// `bt_<base64url>` — so the token shape tells us which strategy to run, and a
// request pays for at most one lookup.
const JWT_SEGMENTS = 3;
const BRIDGE_TOKEN_PREFIX = "bt_";

function extractBearerToken(options: CreateContextOptions): string | null {
	const header = options.context.req.header("authorization");
	if (header?.startsWith(BEARER_PREFIX)) {
		const token = header.slice(BEARER_PREFIX.length).trim();
		return token === "" ? null : token;
	}
	// Native WebSocket/EventSource upgrades (e.g. the VNC viewer) can't set an
	// Authorization header, so those clients pass the bearer via ?access_token=.
	const query = options.context.req.query("access_token")?.trim();
	return query ? query : null;
}

function looksLikeJwt(token: string): boolean {
	return token.split(".").length === JWT_SEGMENTS;
}

async function resolveAuthedAgent(
	options: CreateContextOptions,
	token: string
): Promise<AgentConfig | null> {
	const { tokenService, stores } = options.services;
	if (!(tokenService && stores.agent)) {
		return null;
	}
	return await stores.agent.findByTokenHash(tokenService.hash(token));
}

async function resolveAuthedUser(
	options: CreateContextOptions,
	token: string
): Promise<User | null> {
	const { jwtService, stores } = options.services;
	if (!(jwtService && stores.user)) {
		return null;
	}
	const claims = await jwtService.verify(token);
	if (!claims) {
		return null;
	}
	return stores.user.findById(claims.sub);
}

// Looked up on every bridge-plane request (CLI push/poll). A revoked token
// resolves to null just like an unknown one — revocation must take effect
// immediately, not just on next issuance.
async function resolveAuthedBridgeToken(
	options: CreateContextOptions,
	token: string
): Promise<AuthedBridgeToken | null> {
	const { stores } = options.services;
	if (!stores.bridgeToken) {
		return null;
	}
	const found = await stores.bridgeToken.findByHash(hashToken(token));
	if (!found || found.revokedAt) {
		return null;
	}
	return { tokenId: found.id, userId: found.userId };
}

function clientIp(options: CreateContextOptions): string {
	const fwd = options.context.req.header("x-forwarded-for");
	return fwd?.split(",")[0]?.trim() || "unknown";
}

function userAgent(options: CreateContextOptions): string | null {
	return options.context.req.header("user-agent") ?? null;
}

// Keeps a detached promise alive past the response (Workers executionCtx).
// Falls back to fire-and-forget outside Workers (node dev / tests).
function extractWaitUntil(
	options: CreateContextOptions
): (p: Promise<unknown>) => void {
	try {
		const ctx = options.context.executionCtx;
		if (ctx && typeof ctx.waitUntil === "function") {
			return (p) => ctx.waitUntil(p);
		}
	} catch {
		// hono throws when no execution context exists (plain node) — fall through.
	}
	return (p) => {
		p.catch(() => undefined);
	};
}

async function resolveAuth(
	options: CreateContextOptions,
	token: string
): Promise<{
	authedAgent: AgentConfig | null;
	authedBridgeToken: AuthedBridgeToken | null;
	authedUser: User | null;
}> {
	if (token.startsWith(BRIDGE_TOKEN_PREFIX)) {
		return {
			authedAgent: null,
			authedUser: null,
			authedBridgeToken: await resolveAuthedBridgeToken(options, token),
		};
	}
	if (looksLikeJwt(token)) {
		return {
			authedAgent: null,
			authedBridgeToken: null,
			authedUser: await resolveAuthedUser(options, token),
		};
	}
	return {
		authedBridgeToken: null,
		authedUser: null,
		authedAgent: await resolveAuthedAgent(options, token),
	};
}

export async function createContext(options: CreateContextOptions) {
	const token = extractBearerToken(options);
	const auth = token
		? await resolveAuth(options, token)
		: { authedAgent: null, authedUser: null, authedBridgeToken: null };
	return {
		services: options.services,
		...auth,
		clientIp: clientIp(options),
		userAgent: userAgent(options),
		waitUntil: extractWaitUntil(options),
	};
}

// `authedBridgeToken` is marked optional here (even though createContext
// always sets it) so that pre-existing Context object literals built by other
// routers' tests — which predate the bridge plane and only set
// authedAgent/authedUser — keep type-checking without every one of them
// having to be touched.
export type Context = Omit<
	Awaited<ReturnType<typeof createContext>>,
	"authedBridgeToken"
> & { authedBridgeToken?: AuthedBridgeToken | null };
