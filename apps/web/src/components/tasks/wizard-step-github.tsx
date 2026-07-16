import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { IssueLinker } from "./wizard-github-issues";
import {
	RepositoryPicker,
	SelectedRepository,
} from "./wizard-github-repository";
import type {
	WizardDraft,
	WizardIssue,
	WizardRepository,
} from "./wizard-state";

// Step 3 (GitHub) of the New Task wizard (S4-T2, spec §8.4): an optional
// repository (search or URL paste through the server-side GitHub Connection)
// and optional linked issues that require the repository first. Everything
// here may stay empty — Start never depends on it. Without a GitHub
// connection the controls stay disabled behind a hint to Integrations.

export interface WizardStepGithubProps {
	draft: WizardDraft;
	onAddIssue: (issue: WizardIssue) => void;
	onClearRepository: () => void;
	onRemoveIssue: (issueNumber: number) => void;
	onSelectRepository: (repository: WizardRepository) => void;
}

function ConnectHint() {
	return (
		<p className="rounded-lg bg-muted/60 px-3 py-2 text-muted-foreground text-sm">
			GitHub is not connected — connect it under{" "}
			<Link
				className="underline underline-offset-2 hover:text-foreground"
				to="/integrations"
			>
				Integrations
			</Link>{" "}
			to attach a repository and issues. You can still start the task without
			them.
		</p>
	);
}

export function WizardStepGithub({
	draft,
	onAddIssue,
	onClearRepository,
	onRemoveIssue,
	onSelectRepository,
}: WizardStepGithubProps) {
	const status = useQuery(orpc.github.status.queryOptions());
	if (status.isPending) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-9 w-full rounded-lg" />
				<Skeleton className="h-9 w-full rounded-lg" />
			</div>
		);
	}
	const connected = status.data?.connected === true;
	return (
		<div className="flex flex-col gap-4">
			<p className="text-muted-foreground text-sm">
				Optionally attach a GitHub repository and issues as task context — or
				just Start without them.
			</p>
			{connected ? null : <ConnectHint />}
			{draft.repository ? (
				<div className="flex flex-col gap-1.5">
					<p className="font-medium text-sm leading-none">GitHub repository</p>
					<SelectedRepository
						onClear={onClearRepository}
						repository={draft.repository}
					/>
				</div>
			) : (
				<RepositoryPicker connected={connected} onSelect={onSelectRepository} />
			)}
			<IssueLinker
				issues={draft.issues}
				onAdd={onAddIssue}
				onRemove={onRemoveIssue}
				repository={draft.repository}
			/>
		</div>
	);
}
