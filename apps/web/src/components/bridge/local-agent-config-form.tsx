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
import { type AgentCapabilities, capabilities } from "./agent-capabilities";
import { McpServersConfigField } from "./local-agent-mcp-field";
import {
	ModelField,
	PermissionModeField,
} from "./local-agent-model-permission-fields";
import { SkillsConfigField } from "./local-agent-skills-field";

// The Settings "Config" tab + its field components + the draft/payload
// helpers, split out of local-agent-settings-dialog.tsx to stay under the
// 300-line limit. Fields are grounded in agent-config-claude-code.md.

/** The persisted config shape this dialog edits (mirrors the server's
 * BridgeTokenConfig). Numeric fields are held as strings while editing so the
 * input can be cleared; parsed back on save. */
export interface ConfigDraft {
	appendSystemPrompt: string;
	effort: string;
	maxBudgetUsd: string;
	maxTurns: string;
	/** Registered MCP server ids assigned to this token (R5-a) — unlike the
	 * other fields, an empty array is itself a meaningful saved value ("no
	 * servers assigned"), not "leave unset", so `configFromDraft` always
	 * includes it rather than dropping it when blank. */
	mcpServerIds: string[];
	model: string;
	permissionMode: string;
	/** Registered skill ids (R5-T2) — same convention as `mcpServerIds`. */
	skillIds: string[];
}

/** A number-or-absent config field, held as a string while editing so the
 * input can be cleared (see `ConfigDraft`). */
function numberToDraftString(value: number | undefined): string {
	return value === undefined ? "" : String(value);
}

/** A string-or-absent config field, held as `""` rather than `undefined`
 * while editing (see `ConfigDraft`). */
function stringToDraftString(value: string | undefined): string {
	return value ?? "";
}

/** An always-included id-array field, held as `[]` not `undefined`. */
function idsToDraftArray(value: string[] | undefined): string[] {
	return value ?? [];
}

export function toDraft(config: BridgeTokenRow["config"]): ConfigDraft {
	return {
		appendSystemPrompt: stringToDraftString(config?.appendSystemPrompt),
		effort: stringToDraftString(config?.effort),
		maxBudgetUsd: numberToDraftString(config?.maxBudgetUsd),
		maxTurns: numberToDraftString(config?.maxTurns),
		mcpServerIds: idsToDraftArray(config?.mcpServerIds),
		model: stringToDraftString(config?.model),
		permissionMode: stringToDraftString(config?.permissionMode),
		skillIds: idsToDraftArray(config?.skillIds),
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

/** The draft's non-numeric fields: dropped when blank so an empty field
 * clears the persisted value. */
function identityConfigFields(draft: ConfigDraft) {
	return {
		appendSystemPrompt: draft.appendSystemPrompt.trim() || undefined,
		...(draft.effort ? { effort: draft.effort as EffortLevel } : {}),
		...(draft.model.trim() ? { model: draft.model.trim() } : {}),
		...(draft.permissionMode ? { permissionMode: draft.permissionMode } : {}),
	};
}

/** The draft's numeric fields, parsed back from their held-as-string form and
 * dropped when blank or invalid. */
function numericConfigFields(draft: ConfigDraft) {
	const maxTurnsRaw = draft.maxTurns.trim();
	const maxTurns = maxTurnsRaw === "" ? undefined : Number(maxTurnsRaw);
	const budgetRaw = draft.maxBudgetUsd.trim();
	const maxBudgetUsd = budgetRaw === "" ? undefined : Number(budgetRaw);
	return {
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

/** Builds the persisted-config payload from the edit draft. `mcpServerIds`
 * and `skillIds` are always included (even `[]`) — see `ConfigDraft`. */
export function configFromDraft(draft: ConfigDraft) {
	return {
		...identityConfigFields(draft),
		...numericConfigFields(draft),
		mcpServerIds: draft.mcpServerIds,
		skillIds: draft.skillIds,
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

/** Internal-only props for the form body: the public `AgentConfigFormProps`
 * plus what `ConfigTab` derives from the token's capabilities, deciding which
 * field groups to render (see `ConfigTab` below). */
interface FullFormProps extends AgentConfigFormProps {
	caps: AgentCapabilities;
	showLimits: boolean;
}

/** The per-agent startup config form: claude-only "applies today" fields
 * gated on `showLimits`, model/permission-mode gated on capabilities (R2-a),
 * plus the MCP-servers (R5-a) and skills (R5-T2) pickers, shown for every
 * agent kind. */
function AgentConfigForm({
	caps,
	draft,
	onDraft,
	onSubmit,
	pending,
	showLimits,
}: FullFormProps) {
	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			{showLimits && (
				<>
					<AppendSystemPromptField draft={draft} onDraft={onDraft} />
					<LimitsFields draft={draft} onDraft={onDraft} />
				</>
			)}
			{caps.modelSwitch && <ModelField draft={draft} onDraft={onDraft} />}
			{caps.permissionModes.length > 0 && (
				<PermissionModeField
					draft={draft}
					onDraft={onDraft}
					permissionModes={caps.permissionModes}
				/>
			)}
			<McpServersConfigField draft={draft} onDraft={onDraft} />
			<SkillsConfigField draft={draft} onDraft={onDraft} />
			<DialogFooter className="gap-2">
				<Button disabled={pending} type="submit">
					{pending ? "Saving…" : "Save"}
				</Button>
			</DialogFooter>
		</form>
	);
}

/** The "Config" tab: the startup-config form. Every agent kind gets at least
 * the MCP-servers picker (R5-a), so unlike before R5-a there's no longer a
 * kind with zero configurable fields here. */
export function ConfigTab({
	token,
	...form
}: AgentConfigFormProps & { token: BridgeTokenRow }) {
	const caps = capabilities(token.agentKind);
	const showLimits = agentAppliesConfig(token.agentKind);
	return (
		<TabsContent value="config">
			<AgentConfigForm {...form} caps={caps} showLimits={showLimits} />
		</TabsContent>
	);
}
