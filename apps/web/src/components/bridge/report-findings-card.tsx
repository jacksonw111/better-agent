import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { ClipboardListIcon } from "lucide-react";
import { useState } from "react";
import { ToolCardHeaderRow, ToolCardShell } from "./tool-card-shell";
import { asRecord, readNumber, readString } from "./tool-structured-output";

// fix-tool-render-gaps (G5): the code-review ReportFindings card. Input is
// `{ level?, findings: {file, line?, summary, failure_scenario, category?,
// verdict?, outcome?}[] }` — already sorted most-severe first. The old
// substring category ("find" in "findings") drew an empty Search card; this
// lists each finding with its `file:line` anchor, one-line summary, failure
// scenario, and verdict/outcome/category badges.

export interface ReviewFinding {
	category?: string;
	failureScenario?: string;
	file: string;
	line?: number;
	outcome?: string;
	summary: string;
	verdict?: string;
}

/** Parses ReportFindings' `findings` array (from the tool INPUT, which carries
 * the full structured list) into renderable rows, skipping malformed entries. */
function toFinding(raw: unknown): ReviewFinding | undefined {
	const record = asRecord(raw);
	const file = readString(record?.file);
	const summary = readString(record?.summary);
	if (!(file && summary)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit for eslint consistent-return
		return undefined;
	}
	return {
		category: readString(record?.category),
		failureScenario: readString(record?.failure_scenario),
		file,
		line: readNumber(record?.line),
		outcome: readString(record?.outcome),
		summary,
		verdict: readString(record?.verdict),
	};
}

export function parseReviewFindings(args: unknown): ReviewFinding[] {
	const findings = asRecord(args)?.findings;
	if (!Array.isArray(findings)) {
		return [];
	}
	const rows: ReviewFinding[] = [];
	for (const raw of findings) {
		const finding = toFinding(raw);
		if (finding) {
			rows.push(finding);
		}
	}
	return rows;
}

function anchorOf(finding: ReviewFinding): string {
	return finding.line === undefined
		? finding.file
		: `${finding.file}:${finding.line}`;
}

function Badge({ text }: { text?: string }) {
	if (!text) {
		return null;
	}
	return (
		<span className="shrink-0 rounded bg-background/60 px-1.5 py-0.5 text-muted-foreground text-xs uppercase tracking-wide">
			{text}
		</span>
	);
}

function FindingRow({ finding }: { finding: ReviewFinding }) {
	return (
		<li className="flex flex-col gap-1 py-1.5">
			<div className="flex flex-wrap items-center gap-1.5">
				<span className="truncate font-mono text-foreground text-xs">
					{anchorOf(finding)}
				</span>
				<Badge text={finding.verdict} />
				<Badge text={finding.outcome} />
				<Badge text={finding.category} />
			</div>
			<span className="text-foreground text-sm leading-5">
				{finding.summary}
			</span>
			{finding.failureScenario ? (
				<span className="text-muted-foreground text-xs leading-5">
					{finding.failureScenario}
				</span>
			) : null}
		</li>
	);
}

export function ReportFindingsCard({ tool }: { tool: ToolInvocation }) {
	const findings = parseReviewFindings(tool.args);
	const count = findings.length;
	const hasBody = count > 0;
	const [open, setOpen] = useState(true);
	const label = count === 1 ? "1 finding" : `${count} findings`;
	return (
		<ToolCardShell isError={tool.isError}>
			<ToolCardHeaderRow
				hasBody={hasBody}
				icon={
					<ClipboardListIcon className="size-3.5 shrink-0 text-amber-500" />
				}
				label="Review"
				onToggle={() => setOpen((value) => !value)}
				open={open}
				title={<span className="truncate">{label}</span>}
				tool={tool}
			/>
			{open && hasBody ? (
				<ul className="flex flex-col px-2 pb-2">
					{findings.map((finding) => (
						<FindingRow
							finding={finding}
							key={`${finding.file}:${finding.line ?? 0}:${finding.summary}`}
						/>
					))}
				</ul>
			) : null}
		</ToolCardShell>
	);
}
