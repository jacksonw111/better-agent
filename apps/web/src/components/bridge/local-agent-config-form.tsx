import { Button } from "@better-agent/ui/components/button";
import { DialogFooter } from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { TabsContent } from "@better-agent/ui/components/tabs";
import { Textarea } from "@better-agent/ui/components/textarea";
import type { BridgeTokenRow } from "@/utils/api-types";
import { AGENT_KIND_LABEL } from "./local-agent-kind-icon";

// The Settings "Config" tab + its field components + the draft/payload
// helpers, split out of local-agent-settings-dialog.tsx so neither file
// exceeds the repo's 300-line limit. The fields are grounded in
// docs/research/agent-config-claude-code.md (the SDK Options type).

/** The persisted config shape this dialog edits (mirrors the server's
 * BridgeTokenConfig). Numeric fields are held as strings while editing so the
 * input can be cleared; parsed back on save. */
export interface ConfigDraft {
	appendSystemPrompt: string;
	effort: string;
	maxBudgetUsd: string;
	maxTurns: string;
}

export function toDraft(config: BridgeTokenRow["config"]): ConfigDraft {
	return {
		appendSystemPrompt: config?.appendSystemPrompt ?? "",
		effort: config?.effort ?? "",
		maxBudgetUsd:
			config?.maxBudgetUsd === undefined ? "" : String(config.maxBudgetUsd),
		maxTurns: config?.maxTurns === undefined ? "" : String(config.maxTurns),
	};
}

/** Agent kinds whose bridge adapter actually reads + applies the persisted
 * config today. Others persist it but silently ignore it, so their Config tab
 * shows a "not yet configurable" note instead of fields that do nothing. */
const CONFIGURABLE_AGENT_KINDS = new Set<BridgeTokenRow["agentKind"]>([
	"claude-code",
]);

function agentAppliesConfig(kind: BridgeTokenRow["agentKind"]): boolean {
	return CONFIGURABLE_AGENT_KINDS.has(kind);
}

/** claude's `effort` values (reasoning depth), per the SDK Options type. */
const EFFORT_OPTIONS = ["low", "medium", "high", "xhigh", "max"] as const;

function isValidMaxTurns(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

type EffortLevel = NonNullable<BridgeTokenRow["config"]>["effort"];

/** Builds the persisted-config payload from the edit draft: drops blanks so an
 * empty field clears the value, and parses the numeric fields back. */
export function configFromDraft(draft: ConfigDraft) {
	const maxTurnsRaw = draft.maxTurns.trim();
	const maxTurns = maxTurnsRaw === "" ? undefined : Number(maxTurnsRaw);
	const budgetRaw = draft.maxBudgetUsd.trim();
	const maxBudgetUsd = budgetRaw === "" ? undefined : Number(budgetRaw);
	return {
		appendSystemPrompt: draft.appendSystemPrompt.trim() || undefined,
		...(draft.effort ? { effort: draft.effort as EffortLevel } : {}),
		...(maxBudgetUsd !== undefined &&
		Number.isFinite(maxBudgetUsd) &&
		maxBudgetUsd > 0
			? { maxBudgetUsd }
			: {}),
		...(maxTurns !== undefined && isValidMaxTurns(maxTurns)
			? { maxTurns }
			: {}),
	};
}

interface DraftFieldProps {
	draft: ConfigDraft;
	onDraft: (next: ConfigDraft) => void;
}

function AppendSystemPromptField({ draft, onDraft }: DraftFieldProps) {
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="append-system-prompt">Append system prompt</Label>
			<Textarea
				className="min-h-28"
				id="append-system-prompt"
				onChange={(event) =>
					onDraft({ ...draft, appendSystemPrompt: event.target.value })
				}
				placeholder="Extra instructions appended to the agent's system prompt at launch."
				value={draft.appendSystemPrompt}
			/>
			<p className="text-muted-foreground text-xs">
				Applied on the next session start (claude-code only for now).
			</p>
		</div>
	);
}

function CapsGrid({ draft, onDraft }: DraftFieldProps) {
	return (
		<div className="grid grid-cols-2 gap-3">
			<div className="flex flex-col gap-2">
				<Label htmlFor="max-turns">Max turns</Label>
				<Input
					id="max-turns"
					min={1}
					onChange={(event) =>
						onDraft({ ...draft, maxTurns: event.target.value })
					}
					placeholder="Unlimited"
					type="number"
					value={draft.maxTurns}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="max-budget">Max budget (USD)</Label>
				<Input
					id="max-budget"
					min={0}
					onChange={(event) =>
						onDraft({ ...draft, maxBudgetUsd: event.target.value })
					}
					placeholder="No cap"
					step={0.5}
					type="number"
					value={draft.maxBudgetUsd}
				/>
			</div>
		</div>
	);
}

function LimitsFields({ draft, onDraft }: DraftFieldProps) {
	return (
		<>
			<div className="flex flex-col gap-2">
				<Label htmlFor="effort">Reasoning effort</Label>
				<Select
					onValueChange={(next) =>
						onDraft({
							...draft,
							effort: typeof next === "string" ? next : draft.effort,
						})
					}
					value={draft.effort || undefined}
				>
					<SelectTrigger id="effort" size="sm">
						<SelectValue placeholder="SDK default" />
					</SelectTrigger>
					<SelectContent>
						{EFFORT_OPTIONS.map((level) => (
							<SelectItem key={level} value={level}>
								{level}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<CapsGrid draft={draft} onDraft={onDraft} />
		</>
	);
}

export interface AgentConfigFormProps extends DraftFieldProps {
	onSubmit: () => void;
	pending: boolean;
}

/** The per-agent startup config form (claude-code fields for now; other agents
 * extend this same pattern — see docs/research/agent-config-*.md). */
function AgentConfigForm({
	draft,
	onDraft,
	onSubmit,
	pending,
}: AgentConfigFormProps) {
	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<AppendSystemPromptField draft={draft} onDraft={onDraft} />
			<LimitsFields draft={draft} onDraft={onDraft} />
			<DialogFooter className="gap-2">
				<Button disabled={pending} type="submit">
					{pending ? "Saving…" : "Save"}
				</Button>
			</DialogFooter>
		</form>
	);
}

/** The "Config" tab: the startup-config form for agents whose adapter actually
 * applies it, or an honest note for those it doesn't. */
export function ConfigTab({
	token,
	...form
}: AgentConfigFormProps & { token: BridgeTokenRow }) {
	return (
		<TabsContent value="config">
			{agentAppliesConfig(token.agentKind) ? (
				<AgentConfigForm {...form} />
			) : (
				<p className="text-muted-foreground text-sm">
					{AGENT_KIND_LABEL[token.agentKind]} has no page-configurable startup
					settings yet — its options aren't wired through the bridge. Only
					claude-code is configurable for now.
				</p>
			)}
		</TabsContent>
	);
}
