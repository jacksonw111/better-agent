import type { GithubClient } from "@better-agent/agent/github/github-ports";
import { ORPCError } from "@orpc/server";
import type { AgentServices } from "../services";

// Shared server-side GitHub access (S4-T1/S4-T2, design D7): decrypt the
// caller's stored PAT and build a client bound to it. Used by the github
// router (search/lookup) so the credential boundary lives in exactly one
// place.

/** The slice of AgentServices GitHub access needs — keeps test rigs small. */
export type GithubAccessServices = Pick<
	AgentServices,
	"githubClient" | "secretBox"
> & {
	stores: Pick<AgentServices["stores"], "githubConnection">;
};

/** The caller's GithubClient, or null when GitHub is not connected. */
export async function getGithubClient(
	services: GithubAccessServices,
	userId: string
): Promise<GithubClient | null> {
	const connection = await services.stores.githubConnection.getByUser(userId);
	if (!connection) {
		return null;
	}
	const token = services.secretBox.decrypt(connection.encryptedToken);
	return services.githubClient(token);
}

/** Missing connection = PRECONDITION_FAILED: the feature exists, the setup
 * step doesn't. */
export async function requireGithubClient(
	services: GithubAccessServices,
	userId: string
): Promise<GithubClient> {
	const client = await getGithubClient(services, userId);
	if (!client) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message:
				"GitHub is not connected — add a personal access token under Integrations → GitHub first.",
		});
	}
	return client;
}
