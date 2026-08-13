import type { GithubClient } from "@better-agent/agent/github/github-ports";
import { parseRepositoryUrl } from "@better-agent/agent/github/github-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { requireGithubClient } from "../github/github-access";
import { authorizedUserProcedure } from "../index";

// GitHub Connection router (S4-T1, design D7 / master spec §5.5).
// Credential boundary: the PAT arrives once (connect), is verified against
// GitHub, then only its secret-box ciphertext + last4 persist. No response
// here ever carries a token — status exposes last4 alone, and the decrypted
// token only ever flows server-side into the GithubClient factory.

const TOKEN_LAST4 = 4;

// The connect-time verifyToken call is the single sanctioned "preflight" —
// it's the user's own configuration action (§16).
async function verifiedLogin(client: GithubClient): Promise<string> {
	let identity: { login: string } | null = null;
	try {
		identity = await client.verifyToken();
	} catch (error) {
		const detail = error instanceof Error ? error.message : "unknown error";
		throw new ORPCError("BAD_REQUEST", {
			message: `Could not verify the token against GitHub: ${detail}`,
		});
	}
	if (!identity) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"GitHub rejected the token — check that it exists, has not expired, and has read access to Repository metadata and Issues.",
		});
	}
	return identity.login;
}

function requireFullName(input: string): string {
	const fullName = parseRepositoryUrl(input);
	if (!fullName) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Not a GitHub repository: "${input}" — paste a github.com URL or an owner/repo name.`,
		});
	}
	return fullName;
}

export const githubRouter = {
	connect: authorizedUserProcedure
		.input(z.object({ token: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const login = await verifiedLogin(
				context.services.githubClient(input.token)
			);
			await context.services.stores.githubConnection.upsert({
				userId: context.authedUser.id,
				credentialType: "pat",
				encryptedToken: context.services.secretBox.encrypt(input.token),
				tokenLast4: input.token.slice(-TOKEN_LAST4),
			});
			return { login };
		}),

	status: authorizedUserProcedure.handler(
		async ({
			context,
		}): Promise<{ connected: boolean; tokenLast4?: string }> => {
			const connection =
				await context.services.stores.githubConnection.getByUser(
					context.authedUser.id
				);
			return connection
				? { connected: true, tokenLast4: connection.tokenLast4 }
				: { connected: false };
		}
	),

	disconnect: authorizedUserProcedure.handler(async ({ context }) => {
		await context.services.stores.githubConnection.deleteByUser(
			context.authedUser.id
		);
		return { ok: true };
	}),

	searchRepositories: authorizedUserProcedure
		.input(z.object({ query: z.string() }))
		.handler(async ({ input, context }) => {
			const client = await requireGithubClient(
				context.services,
				context.authedUser.id
			);
			return await client.searchRepositories(input.query);
		}),

	lookupRepository: authorizedUserProcedure
		.input(z.object({ url: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const client = await requireGithubClient(
				context.services,
				context.authedUser.id
			);
			return await client.getRepositoryByFullName(requireFullName(input.url));
		}),

	searchIssues: authorizedUserProcedure
		.input(z.object({ fullName: z.string().min(1), query: z.string() }))
		.handler(async ({ input, context }) => {
			const client = await requireGithubClient(
				context.services,
				context.authedUser.id
			);
			return await client.searchIssues(
				requireFullName(input.fullName),
				input.query
			);
		}),

	getIssue: authorizedUserProcedure
		.input(
			z.object({ fullName: z.string().min(1), number: z.number().int().min(1) })
		)
		.handler(async ({ input, context }) => {
			const client = await requireGithubClient(
				context.services,
				context.authedUser.id
			);
			return await client.getIssue(
				requireFullName(input.fullName),
				input.number
			);
		}),
};
