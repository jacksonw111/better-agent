import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { Textarea } from "@better-agent/ui/components/textarea";
import { cn } from "@better-agent/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";

import { orpc } from "@/utils/orpc";

import type { AgentForm } from "./agent-form";
import { WIZARD_STEPS } from "./agent-form";

type SetForm = (patch: Partial<AgentForm>) => void;

function StepDot({
	index,
	step,
	label,
	onSelect,
}: {
	index: number;
	step: number;
	label: string;
	onSelect?: (index: number) => void;
}) {
	const done = index < step;
	const active = index === step;
	const dot = (
		<>
			<span
				className={cn(
					"flex size-6 items-center justify-center rounded-full border text-xs",
					active && "border-foreground bg-foreground text-background",
					done && "border-foreground bg-foreground/15 text-foreground",
					!(active || done) && "border-border text-muted-foreground"
				)}
			>
				{index + 1}
			</span>
			<span
				className={cn(
					"hidden text-xs sm:inline",
					active || done
						? "font-medium text-foreground"
						: "text-muted-foreground"
				)}
			>
				{label}
			</span>
		</>
	);
	if (!onSelect) {
		return <div className="flex items-center gap-1.5">{dot}</div>;
	}
	return (
		<button
			className="flex items-center gap-1.5 rounded-md hover:opacity-80"
			onClick={() => onSelect(index)}
			type="button"
		>
			{dot}
		</button>
	);
}

// `onStepClick` makes the steps navigable (used when editing an existing agent,
// so any step can be jumped to directly).
export function Stepper({
	step,
	onStepClick,
}: {
	step: number;
	onStepClick?: (index: number) => void;
}) {
	return (
		<div className="flex items-center gap-2">
			{WIZARD_STEPS.map((label, index) => (
				<Fragment key={label}>
					{index > 0 ? (
						<div
							className={cn(
								"h-px flex-1",
								index <= step ? "bg-foreground" : "bg-border"
							)}
						/>
					) : null}
					<StepDot
						index={index}
						label={label}
						onSelect={onStepClick}
						step={step}
					/>
				</Fragment>
			))}
		</div>
	);
}

function Field({
	id,
	label,
	children,
}: {
	id: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor={id}>{label}</Label>
			{children}
		</div>
	);
}

export function IdentityStep({ form, set }: { form: AgentForm; set: SetForm }) {
	return (
		<div className="flex flex-col gap-3">
			<Field id="agent-name" label="Name">
				<Input
					id="agent-name"
					onChange={(event) => set({ name: event.target.value })}
					value={form.name}
				/>
			</Field>
			<Field id="agent-desc" label="Description">
				<Input
					id="agent-desc"
					onChange={(event) => set({ description: event.target.value })}
					value={form.description}
				/>
			</Field>
			<Field id="agent-prompt" label="System prompt">
				<Textarea
					id="agent-prompt"
					onChange={(event) => set({ systemPrompt: event.target.value })}
					rows={5}
					value={form.systemPrompt}
				/>
			</Field>
		</div>
	);
}

function WizardSelect({
	id,
	value,
	onChange,
	placeholder,
	options,
	disabled,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	options: string[];
	disabled?: boolean;
}) {
	return (
		<Select
			disabled={disabled}
			onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
			value={value}
		>
			<SelectTrigger className="w-full" id={id}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option} value={option}>
						{option}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function ModelStep({ form, set }: { form: AgentForm; set: SetForm }) {
	// Web-safe endpoints: no secrets exposed
	const available = useQuery(orpc.providers.available.queryOptions());
	const providers = (available.data ?? []).map((row) => row.providerId);
	const models = useQuery(
		orpc.providers.models.queryOptions({
			input: { providerId: form.providerId },
			enabled: form.providerId !== "",
		})
	);
	if (providers.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No enabled providers. Contact your administrator to set one up.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<Field id="agent-provider" label="Provider">
				<WizardSelect
					id="agent-provider"
					onChange={(value) => set({ providerId: value, modelId: "" })}
					options={providers}
					placeholder="Select a provider…"
					value={form.providerId}
				/>
			</Field>
			<Field id="agent-model" label="Model">
				<WizardSelect
					disabled={form.providerId === ""}
					id="agent-model"
					onChange={(value) => set({ modelId: value })}
					options={(models.data ?? []).map((model) => model.modelId)}
					placeholder="Select a model…"
					value={form.modelId}
				/>
			</Field>
		</div>
	);
}

export function ParamsStep({ form, set }: { form: AgentForm; set: SetForm }) {
	return (
		<div className="flex flex-col gap-3">
			<Field id="agent-temp" label="Temperature (0–2, optional)">
				<Input
					id="agent-temp"
					inputMode="decimal"
					onChange={(event) => set({ temperature: event.target.value })}
					value={form.temperature}
				/>
			</Field>
			<Field id="agent-topp" label="Top P (0–1, optional)">
				<Input
					id="agent-topp"
					inputMode="decimal"
					onChange={(event) => set({ topP: event.target.value })}
					value={form.topP}
				/>
			</Field>
			<Field id="agent-maxout" label="Max output tokens (optional)">
				<Input
					id="agent-maxout"
					inputMode="numeric"
					onChange={(event) => set({ maxOutputTokens: event.target.value })}
					value={form.maxOutputTokens}
				/>
			</Field>
		</div>
	);
}
