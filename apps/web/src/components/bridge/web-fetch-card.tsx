import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { GlobeIcon } from "lucide-react";
import { useState } from "react";
import { ToolCardHeaderRow, ToolCardShell } from "./tool-card-shell";
import { computeErrorLine, ErrorPreviewLine } from "./tool-output-preview";
import {
	asRecord,
	outputRecord,
	readNumber,
	readString,
} from "./tool-structured-output";

// fix-tool-render-gaps (G3): the WebFetch card. Input is `{ url, prompt }`;
// output is `{ url, code, codeText, result, bytes, durationMs }` where `result`
// is the model's answer over the fetched page. Instead of the raw-JSON fallback
// the old `null` category produced, this shows a clickable host, the HTTP
// status, the prompt, and the processed result text.

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function StatusChip({ code, codeText }: { code?: number; codeText?: string }) {
	if (code === undefined) {
		return null;
	}
	return (
		<span className="shrink-0 rounded bg-background/60 px-1.5 py-0.5 font-mono text-muted-foreground text-xs tabular-nums">
			{code}
			{codeText ? ` ${codeText}` : ""}
		</span>
	);
}

function FetchLink({ url }: { url: string }) {
	if (!url) {
		return <span className="text-muted-foreground">WebFetch</span>;
	}
	return (
		<a
			className="truncate text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
			href={url}
			onClick={(event) => event.stopPropagation()}
			rel="noopener noreferrer"
			target="_blank"
		>
			{hostOf(url)}
		</a>
	);
}

function PromptLine({ prompt }: { prompt?: string }) {
	if (!prompt) {
		return null;
	}
	return (
		<div className="px-2 pb-1.5 text-muted-foreground text-xs italic">
			{prompt}
		</div>
	);
}

function ResultSection({ text }: { text: string }) {
	if (!text) {
		return null;
	}
	return (
		<div className="px-2 pb-2">
			<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 px-2 py-1.5 font-mono text-muted-foreground text-xs leading-relaxed">
				{text}
			</pre>
		</div>
	);
}

interface WebFetchData {
	code?: number;
	codeText?: string;
	prompt?: string;
	result: string;
	url: string;
}

function readWebFetch(tool: ToolInvocation): WebFetchData {
	const input = asRecord(tool.args);
	const out = outputRecord(tool);
	return {
		code: readNumber(out?.code),
		codeText: readString(out?.codeText),
		prompt: readString(input?.prompt),
		result: readString(out?.result) ?? "",
		url: readString(input?.url) ?? readString(out?.url) ?? "",
	};
}

export function WebFetchCard({ tool }: { tool: ToolInvocation }) {
	const { code, codeText, prompt, result, url } = readWebFetch(tool);
	const hasBody = result !== "" || prompt !== undefined;
	const [open, setOpen] = useState(tool.isError);
	const errorLine = computeErrorLine(tool, hasBody, open);
	return (
		<ToolCardShell isError={tool.isError}>
			<ToolCardHeaderRow
				hasBody={hasBody}
				icon={<GlobeIcon className="size-3.5 shrink-0 text-sky-500" />}
				label="Fetch"
				onToggle={() => setOpen((value) => !value)}
				open={open}
				title={
					<span className="flex min-w-0 items-center gap-2">
						<FetchLink url={url} />
						<StatusChip code={code} codeText={codeText} />
					</span>
				}
				tool={tool}
			/>
			<ErrorPreviewLine text={errorLine} />
			{open ? (
				<>
					<PromptLine prompt={prompt} />
					<ResultSection text={result} />
				</>
			) : null}
		</ToolCardShell>
	);
}
