// Task Opening Message assembly (master spec §10.1 — the template below is a
// product contract, followed verbatim). The Opening Message is the first
// visible chat message of a Task Conversation: the user's description exactly
// as written (with /skill references left as text), an optional GitHub
// context block, and a short execution context. It never contains the Task
// Name, expanded skill content, or lifecycle text — and a non-empty
// description is never omitted, whatever else is (an empty description means
// an empty message: see assembleOpeningMessage).

import type { BridgeAgentKind } from "../bridge-token-ports";
import type { IssueSnapshot, WorkspaceKind } from "./task-ports";

/** Display names for the supported Agent Runtime kinds (spec §6.1). */
export const AGENT_RUNTIME_LABELS: Record<BridgeAgentKind, string> = {
	"claude-code": "Claude Code",
	codex: "Codex",
	opencode: "OpenCode",
	pi: "Pi",
};

/** §10.1 workspace wording: "repository workspace 或 managed task directory". */
const WORKSPACE_LABELS: Record<WorkspaceKind, string> = {
	repository: "repository workspace",
	standalone: "managed task directory",
};

export interface OpeningMessageInput {
	agentKind: BridgeAgentKind;
	computerName: string;
	/** The user's instruction, verbatim — /skill references stay as text. */
	description: string;
	/** Ordered issue snapshots; each becomes its own `### Issue` block. */
	issues?: IssueSnapshot[];
	/** Omitting this omits the whole `## GitHub context` block. */
	repositoryUrl?: string;
	workspaceKind: WorkspaceKind;
}

function gitHubContextBlocks(
	repositoryUrl: string,
	issues: IssueSnapshot[]
): string[] {
	const repositoryBlock = `## GitHub context\nRepository: ${repositoryUrl}`;
	const issueBlocks = issues.map(
		(issue) =>
			`### Issue #${issue.number}: ${issue.title}\n${issue.body}\n${issue.url}`
	);
	return [repositoryBlock, ...issueBlocks];
}

/** Assembles the §10.1 template. Blocks are joined by blank lines; the GitHub
 * block (repository line + issue sections) is omitted entirely without a
 * repository, while the description and execution context always appear.
 * P1 exception: an EMPTY description means a chat-style session with no
 * initial instruction — the whole Opening Message is the empty string (the
 * web renders nothing), never a context block with no instruction above it. */
export function assembleOpeningMessage(input: OpeningMessageInput): string {
	if (input.description.trim().length === 0) {
		return "";
	}
	const executionContext = [
		"## Execution context",
		`- Computer: ${input.computerName}`,
		`- Agent Runtime: ${AGENT_RUNTIME_LABELS[input.agentKind]}`,
		`- Workspace: ${WORKSPACE_LABELS[input.workspaceKind]}`,
	].join("\n");

	const gitHubBlocks = input.repositoryUrl
		? gitHubContextBlocks(input.repositoryUrl, input.issues ?? [])
		: [];

	return [input.description, ...gitHubBlocks, executionContext].join("\n\n");
}
