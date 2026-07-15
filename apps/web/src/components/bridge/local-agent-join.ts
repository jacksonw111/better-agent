import { env } from "@better-agent/env/web";
import type { BridgeSessionRow, BridgeTokenRow } from "@/utils/api-types";
import {
	deriveLocalAgentStatus,
	type LocalAgentStatus,
} from "./local-agent-status";

type AgentKind = BridgeTokenRow["agentKind"];

/** Stand-in used wherever the raw token isn't available (a legacy hash-only
 * token, or the past-conversations resume hint built off a claude session
 * rather than a specific bound token) — makes the missing `--token` explicit
 * instead of silently omitting it. */
export const PLACEHOLDER_TOKEN = "<your-bridge-token>";

/** The ready-to-run CLI command that connects a local agent with `token`,
 * bound to its own `agentKind`. Shared by the create flow and the bound
 * agent's detail page so the two never render a different command. */
export function bridgeCliCommand(agentKind: AgentKind, token: string): string {
	return `agent-cli --agent ${agentKind} --dir . --token ${token} --server ${env.VITE_SERVER_URL}`;
}

/** P4-T5: the kind-aware variant of `bridgeResumeCliCommand` — the ⌘K content
 * matches reference every provider's on-disk sessions, so the copied command
 * must name the workspace's actual agent, not assume claude. */
export function bridgeResumeCliCommandFor(
	agentKind: AgentKind,
	token: string,
	dir: string | undefined,
	resumeId: string
): string {
	return `agent-cli --agent ${agentKind} --dir ${dir ?? "."} --resume ${resumeId} --token ${token} --server ${env.VITE_SERVER_URL}`;
}

/** The ready-to-run CLI command to resume a specific past claude conversation
 * (the "Past conversations" picker's copy-able hint). `dir` is the
 * conversation's own recorded cwd when known, falling back to `.`. */
export function bridgeResumeCliCommand(
	token: string,
	dir: string | undefined,
	resumeId: string
): string {
	return bridgeResumeCliCommandFor("claude-code", token, dir, resumeId);
}

/** A local agent's display status, extending `LocalAgentStatus` with the
 * case where its token has never had a session at all. */
export type LocalAgentEntryStatus = LocalAgentStatus | "not-connected";

export interface LocalAgentEntry {
	latestSession: BridgeSessionRow | null;
	status: LocalAgentEntryStatus;
	token: BridgeTokenRow;
}

/** Finds `token`'s most recent session (by `createdAt`) among `sessions`, or
 * `null` if the token has none. `createdAt` may arrive as a string or a
 * `Date` depending on serialization, so comparisons always go through
 * `new Date(...).getTime()` rather than assuming a `Date` instance. */
function findLatestSessionForToken(
	tokenId: string,
	sessions: BridgeSessionRow[]
): BridgeSessionRow | null {
	let latest: BridgeSessionRow | null = null;
	for (const session of sessions) {
		if (session.tokenId !== tokenId) {
			continue;
		}
		const isNewer =
			latest === null ||
			new Date(session.createdAt).getTime() >
				new Date(latest.createdAt).getTime();
		if (isNewer) {
			latest = session;
		}
	}
	return latest;
}

/** Joins `listTokens` + `listSessions` client-side into one entry per
 * non-revoked token, carrying its latest session (by `createdAt`) and a
 * display status. Revoked tokens are excluded — they've been removed as
 * local agents. Preserves the input token order. `now` is injectable for
 * deterministic tests. */
export function deriveLocalAgentEntries(
	tokens: BridgeTokenRow[],
	sessions: BridgeSessionRow[],
	now: Date = new Date()
): LocalAgentEntry[] {
	return tokens
		.filter((token) => token.revokedAt === null)
		.map((token) => {
			const latestSession = findLatestSessionForToken(token.id, sessions);
			const status: LocalAgentEntryStatus =
				latestSession === null
					? "not-connected"
					: deriveLocalAgentStatus(latestSession, now);
			return { latestSession, status, token };
		});
}
