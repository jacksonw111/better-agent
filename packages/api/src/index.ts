import { isAdminEmail } from "@better-agent/agent/auth/admin";
import { verifyComputerRequest } from "@better-agent/agent/crypto/computer-signature";
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

// Local bridge CLI auth: a long-lived `bt_…` token bound to a user, not tied
// to any single session (a CLI may run many sessions over the token's life).
export const bridgeProcedure = o.use(({ context, next }) => {
	const bridgeToken = context.authedBridgeToken;
	if (!bridgeToken) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Missing or invalid bridge token",
		});
	}
	return next({ context: { authedBridgeToken: bridgeToken } });
});

// Computer-plane auth (S1-T2, design D1): a client-mode CLI signs every
// request — Ed25519 over `${computerId}.${timestamp}` in the x-ba-* headers —
// verified against the Computer's stored public key, then the replay guard
// enforces the freshness window and strictly increasing per-computer
// timestamps. Every failure is the same UNAUTHORIZED (no oracle for
// attackers), and the guard only runs AFTER signature verification so bogus
// requests can never advance a computer's monotonic floor.
function computerUnauthorized(): ORPCError<"UNAUTHORIZED", unknown> {
	return new ORPCError("UNAUTHORIZED", {
		message: "Computer authentication failed",
	});
}

export const computerProcedure = o.use(async ({ context, next }) => {
	const auth = context.computerAuth;
	if (!auth) {
		throw computerUnauthorized();
	}
	const computer = await context.services.stores.computer.getById(
		auth.computerId
	);
	if (!computer) {
		throw computerUnauthorized();
	}
	const validSignature = verifyComputerRequest(
		computer.publicKeyPem,
		auth.computerId,
		auth.timestampMs,
		auth.signature
	);
	if (!validSignature) {
		throw computerUnauthorized();
	}
	const replay = context.services.computerReplayGuard.check(
		auth.computerId,
		auth.timestampMs,
		Date.now()
	);
	if (replay !== "ok") {
		throw computerUnauthorized();
	}
	return next({ context: { computer } });
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
