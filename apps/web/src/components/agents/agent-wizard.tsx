import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { useState } from "react";

import { MemoriesStep } from "@/components/memory/memories-step";

import {
	type AgentForm,
	EMPTY_AGENT_FORM,
	isLastStep,
	isStepValid,
} from "./agent-form";
import {
	IdentityStep,
	ModelStep,
	ParamsStep,
	Stepper,
	ToolsStep,
} from "./agent-wizard-steps";

const IDENTITY_STEP = 0;
const MODEL_STEP = 1;
const PARAMS_STEP = 2;
const TOOLS_STEP = 3;
const MEMORIES_STEP = 4;

function WizardFooter({
	step,
	canNext,
	pending,
	onCancel,
	onBack,
	onNext,
}: {
	step: number;
	canNext: boolean;
	pending: boolean;
	onCancel: () => void;
	onBack: () => void;
	onNext: () => void;
}) {
	const last = isLastStep(step);
	return (
		<div className="flex justify-between">
			<Button onClick={onCancel} size="sm" type="button" variant="outline">
				Cancel
			</Button>
			<div className="flex gap-2">
				{step > IDENTITY_STEP ? (
					<Button onClick={onBack} size="sm" type="button" variant="outline">
						Back
					</Button>
				) : null}
				<Button
					disabled={!canNext || (last && pending)}
					onClick={onNext}
					size="sm"
					type="button"
				>
					{last ? "Save" : "Next"}
				</Button>
			</div>
		</div>
	);
}

function WizardStepBody({
	step,
	form,
	set,
	agentId,
}: {
	step: number;
	form: AgentForm;
	set: (patch: Partial<AgentForm>) => void;
	agentId: string | null;
}) {
	return (
		<div className="flex min-h-64 flex-col sm:min-h-80">
			{step === IDENTITY_STEP ? <IdentityStep form={form} set={set} /> : null}
			{step === MODEL_STEP ? <ModelStep form={form} set={set} /> : null}
			{step === PARAMS_STEP ? <ParamsStep form={form} set={set} /> : null}
			{step === TOOLS_STEP ? <ToolsStep form={form} set={set} /> : null}
			{step === MEMORIES_STEP ? (
				<MemoriesStep
					agentId={agentId}
					onChange={(ids) => set({ memoryIds: ids })}
					selected={form.memoryIds}
				/>
			) : null}
		</div>
	);
}

export function AgentWizard({
	open,
	onOpenChange,
	initial,
	agentId,
	onSubmit,
	pending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initial: AgentForm | null;
	/** The agent being edited, or null when creating. The Memories step manages
	 * assignments live for an existing agent, deferred for a new one. */
	agentId: string | null;
	onSubmit: (form: AgentForm) => void;
	pending: boolean;
}) {
	const [step, setStep] = useState(IDENTITY_STEP);
	const [form, setForm] = useState<AgentForm>(initial ?? EMPTY_AGENT_FORM);
	const set = (patch: Partial<AgentForm>) =>
		setForm((current) => ({ ...current, ...patch }));
	const next = () =>
		isLastStep(step) ? onSubmit(form) : setStep((current) => current + 1);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{initial ? "Edit agent" : "New agent"}</DialogTitle>
				</DialogHeader>
				<Stepper
					onStepClick={initial ? (index) => setStep(index) : undefined}
					step={step}
				/>
				{/* Fixed height so the modal stays the same size across every step. */}
				<WizardStepBody agentId={agentId} form={form} set={set} step={step} />
				<WizardFooter
					canNext={isStepValid(step, form)}
					onBack={() => setStep((current) => current - 1)}
					onCancel={() => onOpenChange(false)}
					onNext={next}
					pending={pending}
					step={step}
				/>
			</DialogContent>
		</Dialog>
	);
}
