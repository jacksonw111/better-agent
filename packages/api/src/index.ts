import { isAdminEmail } from "@better-agent/agent/auth/admin";
import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

export const agentProcedure = o.use(({ context, next }) => {
	const agent = context.authedAgent;
	if (!agent) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Missing or invalid agent token",
		});
	}
	return next({ context: { authedAgent: agent } });
});

// Context resolves the user from the DB on every request, so this rejects
// blocked users immediately — access tokens die the moment an admin blocks.
function requireActiveUser(context: Context) {
	const user = context.authedUser;
	if (!user) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in required" });
	}
	if (user.blocked) {
		throw new ORPCError("FORBIDDEN", {
			message: "Your account has been suspended",
		});
	}
	return user;
}

export const userProcedure = o.use(({ context, next }) => {
	const user = requireActiveUser(context);
	return next({ context: { authedUser: user } });
});

export const adminProcedure = o.use(async ({ context, next }) => {
	const user = requireActiveUser(context);
	const allowed =
		isAdminEmail(user.email, context.services.authConfig.adminEmails) ||
		(await context.services.stores.user.isAdmin(user.id));
	if (!allowed) {
		throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
	}
	return next({ context: { authedUser: user } });
});

const AUTHZ_TTL_MS = 60_000;

// Is this web user authorized (has redeemed an invite)? Reads the 60s cache,
// re-validating against the authz service when stale. The gate is off entirely
// when authz isn't configured.
export async function isWebAuthorized(
	context: Context,
	subject: string
): Promise<boolean> {
	if (!context.services.authz.enabled) {
		return true;
	}
	const cached = await context.services.stores.webAuthzCache.get(subject);
	if (cached && Date.now() - cached.checkedAt.getTime() < AUTHZ_TTL_MS) {
		return cached.authorized;
	}
	const authorized = await context.services.authz.authorize(subject);
	await context.services.stores.webAuthzCache.set(subject, authorized);
	return authorized;
}

// userProcedure + the invite gate. Staff (admin) bypass it — the gate is only
// for web customers. Apply to web data routes (NOT auth/invite, NOT admin/agent).
export const authorizedUserProcedure = userProcedure.use(
	async ({ context, next }) => {
		if (!context.services.authz.enabled) {
			return next();
		}
		const user = context.authedUser;
		const isStaff =
			isAdminEmail(user.email, context.services.authConfig.adminEmails) ||
			(await context.services.stores.user.isAdmin(user.id));
		if (!(isStaff || (await isWebAuthorized(context, user.id)))) {
			throw new ORPCError("FORBIDDEN", {
				message: "An invite code is required to use this app",
			});
		}
		return next();
	}
);
