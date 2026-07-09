import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";

const accountIdInput = z.object({ accountId: z.uuid() });
const MAX_DETAIL_LEN = 300;

// A 401 from either the admin or runtime plane means the stored tokens no longer
// authenticate — tell the owner exactly that instead of a raw HTTP string.
const UNAUTHORIZED_RE = /\b401\b|unauthorized/i;

// Map an open-connector failure to a client-readable error. Use BAD_REQUEST (not
// INTERNAL_SERVER_ERROR, whose message oRPC masks) so the owner sees the reason.
function toOpenConnectorError(error: unknown): ORPCError<string, undefined> {
	const message = error instanceof Error ? error.message : String(error);
	if (UNAUTHORIZED_RE.test(message)) {
		return new ORPCError("BAD_REQUEST", {
			message:
				"OpenConnector rejected the tokens — they're invalid or expired. Delete and re-create this account with valid tokens.",
		});
	}
	return new ORPCError("BAD_REQUEST", {
		message: `OpenConnector request failed: ${message.slice(0, MAX_DETAIL_LEN) || "unknown error"}`,
	});
}

async function callOpenConnector<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		throw toOpenConnectorError(error);
	}
}

// Asserts the account exists AND belongs to the caller. NOT_FOUND for both
// missing and other-owner accounts, so ownership never leaks.
export async function requireOwnedOpenConnectorAccount(
	context: Context,
	userId: string,
	accountId: string
) {
	const account =
		await context.services.stores.openConnectorAccount.getById(accountId);
	if (!account || account.userId !== userId) {
		throw new ORPCError("NOT_FOUND", {
			message: "OpenConnector account not found",
		});
	}
	return account;
}

async function requireOwnedService(
	context: Context,
	userId: string,
	accountId: string
) {
	await requireOwnedOpenConnectorAccount(context, userId, accountId);
	const service = await context.services.openConnector(accountId);
	if (!service) {
		throw new ORPCError("NOT_FOUND", {
			message: "OpenConnector account not found",
		});
	}
	return service;
}

async function createOwnedAccount(
	context: Context,
	userId: string,
	input: {
		name: string;
		baseUrl: string;
		adminToken: string;
		runtimeToken: string;
	}
) {
	const account = await context.services.stores.openConnectorAccount.create({
		...input,
		userId,
	});
	// Validate BOTH planes against the instance; roll back a bad account so the
	// owner gets immediate feedback. listConnections exercises the admin token
	// (/api/*), listProviders the runtime token (/v1/*) — the latter gates every
	// tool call, so a mistyped runtime token must fail here, not silently later.
	try {
		const service = await context.services.openConnector(account.id);
		if (service) {
			await service.listConnections();
			await service.listProviders();
		}
	} catch (error) {
		await context.services.stores.openConnectorAccount.delete(account.id);
		throw toOpenConnectorError(error);
	}
	await context.services.stores.activity.log({
		userId,
		type: "open_connector_account_added",
		summary: `Added OpenConnector account “${account.name}”`,
	});
	return account;
}

// Per-user open-connector: each user brings their OWN self-hosted instance
// (base URL + admin/runtime tokens); accounts and their provider connections
// are visible and usable only by their owner.
export const openConnectorRouter = {
	listAccounts: authorizedUserProcedure.handler(({ context }) =>
		context.services.stores.openConnectorAccount.listByUser(
			context.authedUser.id
		)
	),

	createAccount: authorizedUserProcedure
		.input(
			z.object({
				name: z.string().min(1),
				baseUrl: z.string().url(),
				adminToken: z.string().min(1),
				runtimeToken: z.string().min(1),
			})
		)
		.handler(({ input, context }) =>
			createOwnedAccount(context, context.authedUser.id, input)
		),

	deleteAccount: authorizedUserProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			const account = await requireOwnedOpenConnectorAccount(
				context,
				context.authedUser.id,
				input.accountId
			);
			await context.services.stores.openConnectorAccount.delete(
				input.accountId
			);
			// Cascade: drop this account from every agent that linked it.
			await context.services.stores.agent.unlinkOpenConnectorAccount(
				context.authedUser.id,
				input.accountId
			);
			await context.services.stores.activity.log({
				userId: context.authedUser.id,
				type: "open_connector_account_removed",
				summary: `Removed OpenConnector account “${account.name}”`,
			});
			return { ok: true };
		}),

	providers: authorizedUserProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			const service = await requireOwnedService(
				context,
				context.authedUser.id,
				input.accountId
			);
			return callOpenConnector(() => service.listProviders());
		}),

	connections: authorizedUserProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			const service = await requireOwnedService(
				context,
				context.authedUser.id,
				input.accountId
			);
			return callOpenConnector(() => service.listConnections());
		}),

	// Key-authenticated providers supply their target service's credential values
	// directly (no OAuth redirect flow).
	connectWithKey: authorizedUserProcedure
		.input(
			accountIdInput.extend({
				service: z.string().min(1),
				apiKey: z.string().min(1),
			})
		)
		.handler(async ({ input, context }) => {
			const service = await requireOwnedService(
				context,
				context.authedUser.id,
				input.accountId
			);
			return callOpenConnector(() =>
				service.connectWithKey({
					service: input.service,
					authType: "api_key",
					values: { apiKey: input.apiKey },
				})
			);
		}),

	disconnect: authorizedUserProcedure
		.input(accountIdInput.extend({ service: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const service = await requireOwnedService(
				context,
				context.authedUser.id,
				input.accountId
			);
			await callOpenConnector(() => service.disconnect(input.service));
			return { ok: true };
		}),

	// The exact tool-assembly pipeline a linked agent runs (configured, non-virtual
	// connections → services → actions), but with errors SURFACED instead of
	// swallowed — makes "why doesn't my agent have the tool" diagnosable.
	tools: authorizedUserProcedure
		.input(accountIdInput)
		.handler(async ({ input, context }) => {
			const service = await requireOwnedService(
				context,
				context.authedUser.id,
				input.accountId
			);
			return callOpenConnector(async () => {
				const connections = await service.listConnections();
				const services = [
					...new Set(
						connections
							.filter((c) => c.configured && !c.virtual)
							.map((c) => c.service)
					),
				];
				if (services.length === 0) {
					return { services, tools: [] };
				}
				const metas = await service.listActions(services);
				return {
					services,
					tools: metas.map((m) => ({
						name: m.id,
						description: m.description,
					})),
				};
			});
		}),
};
