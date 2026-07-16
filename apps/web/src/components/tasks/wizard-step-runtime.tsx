import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Label } from "@better-agent/ui/components/label";
import { cn } from "@better-agent/ui/lib/utils";
import type { ReactNode } from "react";
import { useId } from "react";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import { ComputerStatusChip } from "@/components/computers/computer-status-chip";
import type { ComputerListItem } from "@/utils/api-types";
import type {
	AgentKind,
	RuntimeInventoryItem,
	WizardDraft,
} from "./wizard-state";
import { selectedRuntime } from "./wizard-state";

// Step 1 (Runtime) of the New Task wizard — master spec §8.2. Strict
// top-down reveal: Computer → Runtime → read-only tool facts + Skill
// Palette. Offline computers stay selectable for viewing; the Start gate
// lives on the final step.

function SectionHeading({ hint, title }: { hint?: string; title: string }) {
	return (
		<div className="flex flex-col gap-0.5">
			<h2 className="font-medium text-sm">{title}</h2>
			{hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
		</div>
	);
}

/** Borderless single-select row over a real (visually hidden) radio input,
 * so the browser provides group semantics and arrow-key navigation. The
 * selection itself reads as a tint, with a focus ring only for keyboards. */
function ChoiceRow({
	checked,
	children,
	groupName,
	onSelect,
}: {
	checked: boolean;
	children: ReactNode;
	groupName: string;
	onSelect: () => void;
}) {
	return (
		<label
			className={cn(
				"flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
				checked
					? "bg-accent text-accent-foreground"
					: "bg-muted/40 hover:bg-accent/60"
			)}
		>
			<input
				checked={checked}
				className="sr-only"
				name={groupName}
				onChange={onSelect}
				type="radio"
			/>
			{children}
		</label>
	);
}

function ComputerSection({
	computers,
	onSelect,
	selectedId,
}: {
	computers: ComputerListItem[];
	onSelect: (computer: ComputerListItem) => void;
	selectedId: string | null;
}) {
	const groupName = useId();
	return (
		<section className="flex flex-col gap-2">
			<SectionHeading
				hint="Where the task runs. Offline computers stay visible but can't start a run."
				title="Computer"
			/>
			<div
				aria-label="Computer"
				className="flex flex-col gap-1.5"
				role="radiogroup"
			>
				{computers.map((computer) => (
					<ChoiceRow
						checked={computer.id === selectedId}
						groupName={groupName}
						key={computer.id}
						onSelect={() => onSelect(computer)}
					>
						<span className="flex min-w-0 flex-col">
							<span className="truncate">{computer.name}</span>
							<span className="truncate text-muted-foreground text-xs">
								{computer.platform} · {computer.arch}
							</span>
						</span>
						<ComputerStatusChip connected={computer.connected} />
					</ChoiceRow>
				))}
			</div>
		</section>
	);
}

function runtimeSkillHint(runtime: RuntimeInventoryItem): string | null {
	if (runtime.skillCapability !== "discoverable") {
		return null;
	}
	const count = runtime.skills.length;
	return `${count} ${count === 1 ? "skill" : "skills"}`;
}

function RuntimeSection({
	computer,
	onSelect,
	selectedKind,
}: {
	computer: ComputerListItem;
	onSelect: (agentKind: AgentKind) => void;
	selectedKind: AgentKind | null;
}) {
	const groupName = useId();
	if (computer.runtimeInventory.length === 0) {
		return (
			<section className="flex flex-col gap-2">
				<SectionHeading title="Agent runtime" />
				<p className="text-muted-foreground text-xs">
					No supported runtimes detected on this computer.
				</p>
			</section>
		);
	}
	return (
		<section className="flex flex-col gap-2">
			<SectionHeading hint="Detected on this computer." title="Agent runtime" />
			<div
				aria-label="Agent runtime"
				className="flex flex-col gap-1.5"
				role="radiogroup"
			>
				{computer.runtimeInventory.map((runtime) => (
					<ChoiceRow
						checked={runtime.agentKind === selectedKind}
						groupName={groupName}
						key={runtime.agentKind}
						onSelect={() => onSelect(runtime.agentKind)}
					>
						<span>{AGENT_LABELS[runtime.agentKind]}</span>
						<span className="text-muted-foreground text-xs">
							{runtimeSkillHint(runtime)}
						</span>
					</ChoiceRow>
				))}
			</div>
		</section>
	);
}

/** git/gh presence facts, read-only by design (spec §8.2): a PATH
 * observation, never a configuration decision or an authentication claim. */
function ToolSummarySection({
	tools,
}: {
	tools: ComputerListItem["toolInventory"];
}) {
	if (tools.length === 0) {
		return null;
	}
	return (
		<section className="flex flex-col gap-2">
			<SectionHeading
				hint="Read-only facts — authentication is never checked ahead of time."
				title="Installed tools"
			/>
			<div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
				{tools.map((tool) => (
					<span className={cn(!tool.installed && "opacity-70")} key={tool.name}>
						{tool.name} {tool.installed ? "installed" : "missing"}
					</span>
				))}
			</div>
		</section>
	);
}

function SkillPaletteSection({
	onToggle,
	runtime,
	selectedNames,
}: {
	onToggle: (skillName: string, checked: boolean) => void;
	runtime: RuntimeInventoryItem;
	selectedNames: string[];
}) {
	return (
		<section className="flex flex-col gap-2">
			<SectionHeading
				hint="Checked skills only feed the description's / autocomplete — nothing is sent to the agent."
				title="Skill palette"
			/>
			{runtime.skills.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					No skills detected for this runtime.
				</p>
			) : (
				<div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
					{runtime.skills.map((skill) => (
						<Label
							className="flex items-start gap-2 font-normal"
							key={skill.name}
						>
							<Checkbox
								checked={selectedNames.includes(skill.name)}
								onCheckedChange={(next) => onToggle(skill.name, next === true)}
							/>
							<span className="flex min-w-0 flex-col">
								<span className="truncate">{skill.name}</span>
								<span className="truncate text-muted-foreground text-xs">
									{skill.description}
								</span>
							</span>
						</Label>
					))}
				</div>
			)}
		</section>
	);
}

export function WizardStepRuntime({
	computers,
	draft,
	onSelectComputer,
	onSelectRuntime,
	onTogglePaletteSkill,
}: {
	computers: ComputerListItem[];
	draft: WizardDraft;
	onSelectComputer: (computer: ComputerListItem) => void;
	onSelectRuntime: (agentKind: AgentKind) => void;
	onTogglePaletteSkill: (skillName: string, checked: boolean) => void;
}) {
	const computer = computers.find((item) => item.id === draft.computerId);
	const runtime = selectedRuntime(computer, draft.agentKind);
	return (
		<div className="flex flex-col gap-6">
			<ComputerSection
				computers={computers}
				onSelect={onSelectComputer}
				selectedId={draft.computerId}
			/>
			{computer ? (
				<RuntimeSection
					computer={computer}
					onSelect={onSelectRuntime}
					selectedKind={draft.agentKind}
				/>
			) : null}
			{computer && runtime ? (
				<ToolSummarySection tools={computer.toolInventory} />
			) : null}
			{/* Capability "none" hides the WHOLE palette block (spec §6.4). */}
			{runtime && runtime.skillCapability !== "none" ? (
				<SkillPaletteSection
					onToggle={onTogglePaletteSkill}
					runtime={runtime}
					selectedNames={draft.paletteSkillNames}
				/>
			) : null}
		</div>
	);
}
