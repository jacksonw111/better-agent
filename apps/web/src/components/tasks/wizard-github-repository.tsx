import { parseRepositoryUrl } from "@better-agent/agent/github/github-ports";
import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useId, useState } from "react";
import { useDebouncedValue } from "@/components/list/use-debounced-value";
import type { GithubRepositoryItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import type { WizardRepository } from "./wizard-state";

// The wizard's repository control (S4-T2, spec §6.14/§8.4): search the
// server-side GitHub Connection or paste a URL / `owner/repo`, show the
// selection with its canonical URL, and let it be cleared again.

/** Trailing debounce for the GitHub search inputs on Step 3. */
export const SEARCH_DEBOUNCE_MS = 300;

export function SelectedRepository({
	onClear,
	repository,
}: {
	onClear: () => void;
	repository: WizardRepository;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2">
			<div className="min-w-0">
				<p className="truncate font-medium text-sm">{repository.fullName}</p>
				<p className="truncate text-muted-foreground text-xs">
					{repository.url}
				</p>
			</div>
			<Button
				aria-label="Clear repository"
				onClick={onClear}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				<XIcon aria-hidden className="size-4" />
			</Button>
		</div>
	);
}

function toWizardRepository(item: GithubRepositoryItem): WizardRepository {
	return { fullName: item.fullName, url: item.url };
}

/** Debounced repository candidates: a name search plus, when the text parses
 * as a GitHub URL / `owner/repo`, a direct lookup hit (offered first). */
function useRepositoryCandidates(connected: boolean, debounced: string) {
	const search = useQuery({
		...orpc.github.searchRepositories.queryOptions({
			input: { query: debounced },
		}),
		enabled: connected && debounced.trim().length > 0,
	});
	const lookup = useQuery({
		...orpc.github.lookupRepository.queryOptions({
			input: { url: debounced },
		}),
		enabled: connected && parseRepositoryUrl(debounced) !== null,
	});
	const lookupHit = lookup.data ?? null;
	const searchResults = (search.data ?? []).filter(
		(item) => item.fullName !== lookupHit?.fullName
	);
	return { lookupHit, searchResults };
}

function RepositoryResult({
	item,
	label,
	onPick,
}: {
	item: GithubRepositoryItem;
	label: string;
	onPick: (item: GithubRepositoryItem) => void;
}) {
	return (
		<button
			className="flex flex-col rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
			onClick={() => onPick(item)}
			type="button"
		>
			<span className="font-medium text-sm">{label}</span>
			{item.description ? (
				<span className="truncate text-muted-foreground text-xs">
					{item.description}
				</span>
			) : null}
		</button>
	);
}

function RepositoryResults({
	lookupHit,
	onPick,
	searchResults,
}: {
	lookupHit: GithubRepositoryItem | null;
	onPick: (item: GithubRepositoryItem) => void;
	searchResults: GithubRepositoryItem[];
}) {
	return (
		<div className="flex flex-col gap-1">
			{lookupHit ? (
				<RepositoryResult
					item={lookupHit}
					label={`Use ${lookupHit.fullName}`}
					onPick={onPick}
				/>
			) : null}
			{searchResults.map((item) => (
				<RepositoryResult
					item={item}
					key={item.fullName}
					label={item.fullName}
					onPick={onPick}
				/>
			))}
		</div>
	);
}

/** Search-or-paste repository picker (spec §8.4). */
export function RepositoryPicker({
	connected,
	onSelect,
}: {
	connected: boolean;
	onSelect: (repository: WizardRepository) => void;
}) {
	const inputId = useId();
	const [query, setQuery] = useState("");
	const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
	const candidates = useRepositoryCandidates(connected, debounced);
	const pick = (item: GithubRepositoryItem) => {
		setQuery("");
		onSelect(toWizardRepository(item));
	};
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={inputId}>GitHub repository</Label>
			<Input
				disabled={!connected}
				id={inputId}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Search repositories or paste a URL"
				value={query}
			/>
			{connected && debounced.trim().length > 0 ? (
				<RepositoryResults {...candidates} onPick={pick} />
			) : null}
		</div>
	);
}
