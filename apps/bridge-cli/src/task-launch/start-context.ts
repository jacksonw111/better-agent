import type { ManagedToolInventoryItem } from "@better-agent/agent/computer-ports";
import type { IssueSnapshot } from "@better-agent/agent/task-ports";

// S25-T1 (master spec §10.2): the Agent-facing Task Start Context, assembled
// CLIENT-side (D3's split — the server ships the verbatim description +
// unexpanded skill references + issue snapshots; the client resolves skills,
// adds the real workspace path and the known-tool facts). The environment
// block follows the §10.2 template verbatim: installed-tool fact lines ONLY
// for tools that are installed (never a health or auth promise), the
// no-preflight sentence, and the absolute Task workspace path. Never a Skill
// Palette, a full software list, or any permission policy (§10.2's ban).

export interface StartContextInput {
	/** The user's instruction, verbatim, references unexpanded (§6.9). */
	description: string;
	/** This Run's issue snapshots, in the user's order (S4-T2, §6.15). */
	issueSnapshots: IssueSnapshot[];
	/** Canonical repository web URL from the Launch payload (S4-T2) — renders
	 * the §10.1 `Repository:` line; absent/null for stand-alone Tasks. */
	repositoryUrl?: string | null;
	/** Local installed-or-not facts (detect-inventory, D2). */
	toolInventory: ManagedToolInventoryItem[];
	/** The prepared workspace's absolute path. */
	workspacePath: string;
}

export interface StartContextDeps {
	/** D6's single skill-resolution seam. Identity for runtimes whose skill
	 * capability is `none` — they never produce references. */
	resolveSkillReferences(description: string): Promise<string>;
}

const NO_PREFLIGHT_FACT =
	"Authentication and current health have not been preflighted; actual command output is authoritative.";

/** §10.1's GitHub block, reused verbatim for the agent-facing text (matches
 * opening-message.ts's `gitHubContextBlocks`): a `Repository:` line when the
 * payload carries one, then one issue section per snapshot, in order. The
 * whole block is omitted when there is neither. */
function gitHubBlocks(
	repositoryUrl: string | null | undefined,
	issues: IssueSnapshot[]
): string[] {
	if (!repositoryUrl && issues.length === 0) {
		return [];
	}
	const header = repositoryUrl
		? `## GitHub context\nRepository: ${repositoryUrl}`
		: "## GitHub context";
	return [
		header,
		...issues.map(
			(issue) =>
				`### Issue #${issue.number}: ${issue.title}\n${issue.body}\n${issue.url}`
		),
	];
}

function environmentBlock(
	toolInventory: ManagedToolInventoryItem[],
	workspacePath: string
): string {
	const toolFacts = toolInventory
		.filter((tool) => tool.installed)
		.map((tool) => `- ${tool.name} is installed and managed by Better Agent.`);
	return [
		"## Agent environment",
		...toolFacts,
		`- ${NO_PREFLIGHT_FACT}`,
		`- Task workspace: ${workspacePath}`,
	].join("\n");
}

/** Assembles the Task Start Context: resolved description, the GitHub block
 * (when this Run has a repository or issue snapshots), then the environment
 * block — joined by blank lines like the §10.1 opening message. */
export async function buildTaskStartContext(
	input: StartContextInput,
	deps: StartContextDeps
): Promise<string> {
	const resolvedDescription = await deps.resolveSkillReferences(
		input.description
	);
	return [
		resolvedDescription,
		...gitHubBlocks(input.repositoryUrl, input.issueSnapshots),
		environmentBlock(input.toolInventory, input.workspacePath),
	].join("\n\n");
}
