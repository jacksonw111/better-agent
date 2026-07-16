import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { LaptopIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/layout/empty-state";
import type { ComputerListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { StepIndicator, WizardFooter } from "./wizard-chrome";
import type {
	AgentKind,
	WizardDraft,
	WizardIssue,
	WizardRepository,
	WizardStep,
} from "./wizard-state";
import {
	EMPTY_WIZARD_DRAFT,
	paletteSkills,
	requestStepComplete,
	selectedRuntime,
	WIZARD_STEPS,
	withComputerSelected,
	withIssueAdded,
	withIssueRemoved,
	withPaletteSkillToggled,
	withRepositoryCleared,
	withRepositorySelected,
	withRuntimeSelected,
} from "./wizard-state";
import { WizardStepGithub } from "./wizard-step-github";
import { WizardStepRequest } from "./wizard-step-request";
import { WizardStepRuntime } from "./wizard-step-runtime";

// The three-step New Task wizard — fixed Runtime → Request → GitHub order,
// no Review page (master spec §8/§18.2). All step inputs live in one draft
// so navigating between steps never loses what was already filled in; a
// direct URL visit always begins at Step 1.

/** Matches COMPUTER_HEARTBEAT_INTERVAL_MS so Connected/Offline stays fresh
 * while the wizard is open — the Start gate depends on it. */
const LIST_REFETCH_INTERVAL_MS = 10_000;

/** One draft object + dependency-safe transition callbacks (wizard-state). */
function useWizardDraft() {
	const [draft, setDraft] = useState<WizardDraft>(EMPTY_WIZARD_DRAFT);
	return {
		addIssue: (issue: WizardIssue) =>
			setDraft((current) => withIssueAdded(current, issue)),
		clearRepository: () => setDraft(withRepositoryCleared),
		draft,
		removeIssue: (issueNumber: number) =>
			setDraft((current) => withIssueRemoved(current, issueNumber)),
		selectComputer: (computer: ComputerListItem) =>
			setDraft((current) => withComputerSelected(current, computer)),
		selectRepository: (repository: WizardRepository) =>
			setDraft((current) => withRepositorySelected(current, repository)),
		selectRuntime: (agentKind: AgentKind) =>
			setDraft((current) => withRuntimeSelected(current, agentKind)),
		setDescription: (description: string) =>
			setDraft((current) => ({ ...current, description })),
		setName: (name: string) => setDraft((current) => ({ ...current, name })),
		togglePaletteSkill: (skillName: string, checked: boolean) =>
			setDraft((current) =>
				withPaletteSkillToggled(current, skillName, checked)
			),
	};
}

/** Start (§8.5, client side): one atomic create → navigate into the Task
 * Conversation; a rejected Start surfaces the server's real error as a toast
 * and leaves the wizard exactly where it was. */
function useStartTask(draft: WizardDraft) {
	const navigate = useNavigate();
	const create = useMutation(
		orpc.tasks.create.mutationOptions({
			onSuccess: ({ taskId }: { taskId: string }) =>
				navigate({ params: { taskId }, to: "/tasks/$taskId" }),
			onError: (error: Error) => toast.error(error.message),
		})
	);
	const start = () => {
		if (draft.computerId === null || draft.agentKind === null) {
			return;
		}
		// GitHub context rides along only when a repository was picked (§8.4) —
		// an all-empty Step 3 sends exactly the stand-alone payload.
		const github = draft.repository
			? {
					issueNumbers: draft.issues.map((issue) => issue.number),
					repositoryFullName: draft.repository.fullName,
				}
			: {};
		create.mutate({
			agentKind: draft.agentKind,
			computerId: draft.computerId,
			description: draft.description,
			name: draft.name,
			...github,
		});
	};
	return { start, starting: create.isPending };
}

function StepContent({
	computers,
	errorsVisible,
	step,
	wizard,
}: {
	computers: ComputerListItem[];
	errorsVisible: boolean;
	step: WizardStep;
	wizard: ReturnType<typeof useWizardDraft>;
}) {
	if (step === "runtime") {
		return (
			<WizardStepRuntime
				computers={computers}
				draft={wizard.draft}
				onSelectComputer={wizard.selectComputer}
				onSelectRuntime={wizard.selectRuntime}
				onTogglePaletteSkill={wizard.togglePaletteSkill}
			/>
		);
	}
	if (step === "request") {
		const computer = computers.find(
			(item) => item.id === wizard.draft.computerId
		);
		const runtime = selectedRuntime(computer, wizard.draft.agentKind);
		return (
			<WizardStepRequest
				draft={wizard.draft}
				errorsVisible={errorsVisible}
				onDescriptionChange={wizard.setDescription}
				onNameChange={wizard.setName}
				paletteSkills={paletteSkills(runtime, wizard.draft.paletteSkillNames)}
			/>
		);
	}
	return (
		<WizardStepGithub
			draft={wizard.draft}
			onAddIssue={wizard.addIssue}
			onClearRepository={wizard.clearRepository}
			onRemoveIssue={wizard.removeIssue}
			onSelectRepository={wizard.selectRepository}
		/>
	);
}

function WizardBody({ computers }: { computers: ComputerListItem[] }) {
	const [stepIndex, setStepIndex] = useState(0);
	const [errorsVisible, setErrorsVisible] = useState(false);
	const wizard = useWizardDraft();
	const { start, starting } = useStartTask(wizard.draft);
	const step: WizardStep = WIZARD_STEPS[stepIndex] ?? "runtime";
	const computer = computers.find(
		(item) => item.id === wizard.draft.computerId
	);
	const runtime = selectedRuntime(computer, wizard.draft.agentKind);

	const goBack = () => setStepIndex((index) => Math.max(index - 1, 0));
	const goNext = () => {
		if (step === "request" && !requestStepComplete(wizard.draft)) {
			setErrorsVisible(true);
			return;
		}
		setStepIndex((index) => Math.min(index + 1, WIZARD_STEPS.length - 1));
	};

	return (
		<div className="flex flex-col gap-6">
			<StepIndicator current={step} />
			<StepContent
				computers={computers}
				errorsVisible={errorsVisible}
				step={step}
				wizard={wizard}
			/>
			<WizardFooter
				canAdvance={runtime !== null}
				computerOffline={computer !== undefined && !computer.connected}
				onBack={goBack}
				onNext={goNext}
				onStart={start}
				starting={starting}
				step={step}
			/>
		</div>
	);
}

export function NewTaskWizard() {
	const query = useQuery({
		...orpc.computers.list.queryOptions(),
		refetchInterval: LIST_REFETCH_INTERVAL_MS,
	});
	if (query.isPending) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-6 w-56" />
				<Skeleton className="h-40 w-full rounded-xl" />
			</div>
		);
	}
	const computers = query.data ?? [];
	if (computers.length === 0) {
		return (
			<EmptyState
				action={
					<Button render={<Link to="/computers" />} size="sm">
						Pair a computer
					</Button>
				}
				body="Tasks run on your own machines. Pair a computer first, then come back to start a task."
				icon={LaptopIcon}
				title="No computers to run on"
			/>
		);
	}
	return <WizardBody computers={computers} />;
}
