import type {
	GithubClient,
	GithubRepositorySummary,
} from "@better-agent/agent/github/github-ports";
import type { IssueSnapshot, TaskRow } from "@better-agent/agent/task-ports";
import { ORPCError } from "@orpc/server";
import type { Context } from "../context";
import { getGithubClient, requireGithubClient } from "../github/github-access";

// S4-T2: the GitHub side of Task Start and retry (master spec §6.14/§6.15).
// Start resolves the optional repository + linked-issue snapshots BEFORE any
// write (§8.5 steps 4–5); retry re-fetches each linked issue's LATEST
// snapshot for the new Run — snapshots belong to the Run, recording exactly
// what the Agent saw at ITS launch.

type Services = Context["services"];

/** The Task columns a resolved (or absent) repository contributes (§6.14):
 * identity + the GitHub-resolved metadata the Launch payload needs. */
export function repositoryTaskFields(
	repository: GithubRepositorySummary | null
) {
	return {
		repositoryCloneUrl: repository?.cloneUrl ?? null,
		repositoryDefaultBranch: repository?.defaultBranch ?? null,
		repositoryFullName: repository?.fullName ?? null,
		repositoryUrl: repository?.url ?? null,
	};
}

function toIssueSnapshot(issue: {
	body: string;
	number: number;
	title: string;
	url: string;
}): IssueSnapshot {
	return {
		body: issue.body,
		number: issue.number,
		title: issue.title,
		url: issue.url,
	};
}

/** §8.5 step 5: title/body/url snapshots (never comments, §6.15), in the
 * user's order. An issue that doesn't resolve inside the repository — a PR
 * number, another repo's issue, a typo — rejects the whole Start. */
async function fetchIssueSnapshots(
	client: GithubClient,
	fullName: string,
	issueNumbers: number[]
): Promise<IssueSnapshot[]> {
	return await Promise.all(
		issueNumbers.map(async (issueNumber) => {
			const issue = await client.getIssue(fullName, issueNumber);
			if (!issue) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Issue #${issueNumber} does not belong to ${fullName} (or is not an issue)`,
				});
			}
			return toIssueSnapshot(issue);
		})
	);
}

/** §8.5 step 4 + §19.2: resolves the optional GitHub context BEFORE any
 * write. Issues without a repository are rejected outright (§6.15); a
 * repository requires the caller's GitHub connection and must be accessible
 * with it — that lookup also yields the real cloneUrl/defaultBranch the
 * Launch payload carries (no assumed "main"). */
export async function resolveGithubStartContext(
	services: Services,
	userId: string,
	input: { issueNumbers?: number[]; repositoryFullName?: string }
): Promise<{
	issueSnapshots: IssueSnapshot[];
	repository: GithubRepositorySummary | null;
}> {
	const issueNumbers = input.issueNumbers ?? [];
	if (!input.repositoryFullName) {
		if (issueNumbers.length > 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Linked issues require a repository — pick one first",
			});
		}
		return { issueSnapshots: [], repository: null };
	}
	const client = await requireGithubClient(services, userId);
	const repository = await client.getRepositoryByFullName(
		input.repositoryFullName
	);
	if (!repository) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Repository ${input.repositoryFullName} is not accessible with your GitHub connection`,
		});
	}
	const issueSnapshots = await fetchIssueSnapshots(
		client,
		repository.fullName,
		issueNumbers
	);
	return { issueSnapshots, repository };
}

/** §6.15/§16: a retried Run re-fetches each linked issue's LATEST snapshot —
 * a Run's snapshots record what the Agent saw at ITS launch. Anything that
 * prevents a refresh (connection removed, issue deleted or inaccessible,
 * transport failure) keeps that issue's previous snapshot and never blocks
 * the retry — the agent discovers stale reality through real tool output. */
export async function refreshedIssueSnapshots(
	services: Services,
	task: TaskRow,
	previous: IssueSnapshot[]
): Promise<IssueSnapshot[]> {
	const fullName = task.repositoryFullName;
	if (!fullName || previous.length === 0) {
		return previous;
	}
	const client = await getGithubClient(services, task.userId).catch(() => null);
	if (!client) {
		return previous;
	}
	return await Promise.all(
		previous.map(async (snapshot) => {
			try {
				const issue = await client.getIssue(fullName, snapshot.number);
				return issue ? toIssueSnapshot(issue) : snapshot;
			} catch {
				return snapshot;
			}
		})
	);
}
