import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useDebouncedValue } from "@/components/list/use-debounced-value";
import type { GithubIssueItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { SEARCH_DEBOUNCE_MS } from "./wizard-github-repository";
import type { WizardIssue, WizardRepository } from "./wizard-state";

// The wizard's linked-issues control (S4-T2, spec §6.15/§8.4): disabled until
// a repository is picked, then a debounced issue search plus add-by-number
// build an ordered, removable list. Only issue NUMBERS travel in the Start
// payload — the server snapshots title/body/url per Run at launch.

const ISSUE_NUMBER_PATTERN = /^\d+$/;

/** The typed text as an issue number, or null when it isn't purely one. */
function parseIssueNumber(text: string): number | null {
	const trimmed = text.trim();
	return ISSUE_NUMBER_PATTERN.test(trimmed) ? Number(trimmed) : null;
}

/** Debounced issue-search results minus the already-linked issues. */
function useIssueCandidates(
	repository: WizardRepository | null,
	debounced: string,
	issues: WizardIssue[]
) {
	const search = useQuery({
		...orpc.github.searchIssues.queryOptions({
			input: { fullName: repository?.fullName ?? "", query: debounced },
		}),
		enabled: repository !== null && debounced.trim().length > 0,
	});
	return (search.data ?? []).filter(
		(item) => !issues.some((issue) => issue.number === item.number)
	);
}

/** Fetch-and-add for a typed issue number: the server validates it belongs to
 * the repository; a miss surfaces as a toast, never a silent no-op. */
function useAddIssueByNumber(
	fullName: string,
	onAdd: (issue: WizardIssue) => void
) {
	const queryClient = useQueryClient();
	return async (issueNumber: number) => {
		try {
			const issue = await queryClient.fetchQuery(
				orpc.github.getIssue.queryOptions({
					input: { fullName, number: issueNumber },
				})
			);
			if (!issue) {
				toast.error(`Issue #${issueNumber} was not found in ${fullName}`);
				return;
			}
			onAdd({ number: issue.number, title: issue.title });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	};
}

function IssueResult({
	item,
	onPick,
}: {
	item: GithubIssueItem;
	onPick: (issue: WizardIssue) => void;
}) {
	return (
		<button
			className="flex items-baseline gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
			onClick={() => onPick({ number: item.number, title: item.title })}
			type="button"
		>
			<span className="font-medium text-sm">#{item.number}</span>
			<span className="truncate text-sm">{item.title}</span>
		</button>
	);
}

function IssueSuggestions({
	candidates,
	numberQuery,
	onAddByNumber,
	onPick,
}: {
	candidates: GithubIssueItem[];
	numberQuery: number | null;
	onAddByNumber: (issueNumber: number) => void;
	onPick: (issue: WizardIssue) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			{numberQuery === null ? null : (
				<Button
					className="w-fit"
					onClick={() => onAddByNumber(numberQuery)}
					size="sm"
					type="button"
					variant="outline"
				>
					Add issue #{numberQuery}
				</Button>
			)}
			{candidates.map((item) => (
				<IssueResult item={item} key={item.number} onPick={onPick} />
			))}
		</div>
	);
}

function LinkedIssueRow({
	issue,
	onRemove,
}: {
	issue: WizardIssue;
	onRemove: (issueNumber: number) => void;
}) {
	return (
		<li className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2">
			<p className="truncate text-sm">
				<span className="font-medium">#{issue.number}</span> {issue.title}
			</p>
			<Button
				aria-label={`Remove issue #${issue.number}`}
				onClick={() => onRemove(issue.number)}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				<XIcon aria-hidden className="size-4" />
			</Button>
		</li>
	);
}

function AddedIssueList({
	issues,
	onRemove,
}: {
	issues: WizardIssue[];
	onRemove: (issueNumber: number) => void;
}) {
	if (issues.length === 0) {
		return null;
	}
	return (
		<ul aria-label="Added issues" className="flex flex-col gap-1">
			{issues.map((issue) => (
				<LinkedIssueRow issue={issue} key={issue.number} onRemove={onRemove} />
			))}
		</ul>
	);
}

/** Linked issues (§8.4): disabled until a repository is picked; then search
 * results and an add-by-number affordance append to an ordered, removable
 * list. */
export function IssueLinker({
	issues,
	onAdd,
	onRemove,
	repository,
}: {
	issues: WizardIssue[];
	onAdd: (issue: WizardIssue) => void;
	onRemove: (issueNumber: number) => void;
	repository: WizardRepository | null;
}) {
	const inputId = useId();
	const [query, setQuery] = useState("");
	const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
	const candidates = useIssueCandidates(repository, debounced, issues);
	const addByNumber = useAddIssueByNumber(repository?.fullName ?? "", onAdd);
	const add = (issue: WizardIssue) => {
		setQuery("");
		onAdd(issue);
	};
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={inputId}>Linked issues</Label>
			<AddedIssueList issues={issues} onRemove={onRemove} />
			<Input
				disabled={repository === null}
				id={inputId}
				onChange={(event) => setQuery(event.target.value)}
				placeholder={
					repository
						? "Search issues or enter a number"
						: "Select a repository first"
				}
				value={query}
			/>
			{repository && debounced.trim().length > 0 ? (
				<IssueSuggestions
					candidates={candidates}
					numberQuery={parseIssueNumber(debounced)}
					onAddByNumber={(issueNumber) => {
						setQuery("");
						addByNumber(issueNumber);
					}}
					onPick={add}
				/>
			) : null}
		</div>
	);
}
