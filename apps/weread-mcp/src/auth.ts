import type { Context, Next } from "hono";

const UNAUTHORIZED = 401;
const BEARER_TOKEN_PATTERN = /^Bearer\s+(.+)$/i;

interface AuthEnv {
	API_TOKEN?: string;
}

function presentedToken(c: Context): string {
	const auth = c.req.header("authorization");
	const bearer = auth?.match(BEARER_TOKEN_PATTERN)?.[1]?.trim();
	return bearer ?? c.req.header("x-api-token") ?? c.req.query("token") ?? "";
}

export async function requireToken(c: Context, next: Next) {
	if (c.req.method === "OPTIONS") {
		return await next();
	}
	const expected = (c.env as AuthEnv | undefined)?.API_TOKEN ?? "";
	if (!expected) {
		return await next();
	}
	if (presentedToken(c) === expected) {
		return await next();
	}
	return c.json({ error: "unauthorized" }, UNAUTHORIZED);
}
