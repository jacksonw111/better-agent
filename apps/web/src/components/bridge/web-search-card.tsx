import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { ToolCardHeaderRow, ToolCardShell } from "./tool-card-shell";
import { computeErrorLine, ErrorPreviewLine } from "./tool-output-preview";
import {
	asRecord,
	outputRecord,
	readNumber,
	readString,
} from "./tool-structured-output";

// fix-tool-render-gaps (G4): the WebSearch card. Input is `{ query, … }`;
// output is `{ query, results, searchCount, durationSeconds }` where `results`
// interleaves `{ tool_use_id, content: { title, url }[] }` hit groups with bare
// string commentary. The old substring category rendered only the query and
// dropped the sources into raw JSON — this keeps the query AND lists every hit
// as a titled, clickable link.

export interface SearchSource {
	title: string;
	url: string;
}

/** Flattens WebSearch's `results` (hit groups interleaved with commentary
 * strings) into a flat de-duplicated list of `{ title, url }` sources. */
function collectFromGroup(
	group: unknown,
	seen: Set<string>,
	sources: SearchSource[]
): void {
	const content = asRecord(group)?.content;
	if (!Array.isArray(content)) {
		return;
	}
	for (const hit of content) {
		const record = asRecord(hit);
		const url = readString(record?.url);
		if (!url || seen.has(url)) {
			continue;
		}
		seen.add(url);
		sources.push({ title: readString(record?.title) ?? url, url });
	}
}

export function collectSearchSources(results: unknown): SearchSource[] {
	if (!Array.isArray(results)) {
		return [];
	}
	const sources: SearchSource[] = [];
	const seen = new Set<string>();
	for (const group of results) {
		collectFromGroup(group, seen, sources);
	}
	return sources;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function SourceRow({ source }: { source: SearchSource }) {
	return (
		<li className="flex flex-col gap-0.5 py-1">
			<a
				className="truncate text-foreground text-sm hover:underline"
				href={source.url}
				rel="noopener noreferrer"
				target="_blank"
			>
				{source.title}
			</a>
			<span className="truncate text-muted-foreground text-xs">
				{hostOf(source.url)}
			</span>
		</li>
	);
}

function SourceList({ sources }: { sources: SearchSource[] }) {
	if (sources.length === 0) {
		return null;
	}
	return (
		<ul className="flex flex-col px-2 pb-2">
			{sources.map((source) => (
				<SourceRow key={source.url} source={source} />
			))}
		</ul>
	);
}

function CountChip({ count }: { count?: number }) {
	if (count === undefined || count === 0) {
		return null;
	}
	const label = count === 1 ? "1 search" : `${count} searches`;
	return (
		<span className="shrink-0 rounded bg-background/60 px-1.5 py-0.5 text-muted-foreground text-xs tabular-nums">
			{label}
		</span>
	);
}

export function WebSearchCard({ tool }: { tool: ToolInvocation }) {
	const input = asRecord(tool.args);
	const out = outputRecord(tool);
	const query = readString(input?.query) ?? readString(out?.query) ?? "";
	const sources = collectSearchSources(out?.results);
	const searchCount = readNumber(out?.searchCount);
	const hasBody = sources.length > 0;
	const [open, setOpen] = useState(tool.isError);
	const errorLine = computeErrorLine(tool, hasBody, open);
	return (
		<ToolCardShell isError={tool.isError}>
			<ToolCardHeaderRow
				hasBody={hasBody}
				icon={<SearchIcon className="size-3.5 shrink-0 text-teal-500" />}
				label="Search"
				onToggle={() => setOpen((value) => !value)}
				open={open}
				title={
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate">{query || tool.toolName}</span>
						<CountChip count={searchCount} />
					</span>
				}
				tool={tool}
			/>
			<ErrorPreviewLine text={errorLine} />
			{open ? <SourceList sources={sources} /> : null}
		</ToolCardShell>
	);
}
