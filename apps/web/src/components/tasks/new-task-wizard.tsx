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
// so navigating between steps never loses what was already filled in. It
// renders inside the New Task modal (new-task-dialog.tsx), which owns the
// draft so it can gate closing on unsaved content; a fresh open always
// begins at Step 1 because this panel remounts with the dialog.

/** Matches COMPUTER_HEARTBEAT_INTERVAL_MS so Connected/Offline stays fresh
 * while the wizard is open — the Start gate depends on it. */
const LIST_REFETCH_INTERVAL_MS = 10_000;

/** One draft object + dependency-safe transition callbacks (wizard-state).
 * Hoisted into the modal shell so a confirmed close can reset it. */
export function useWizardDraft() {
	const [draft, setDraft] = useState<WizardDraft>(EMPTY_WIZARD_DRAFT);
	return {
		addIssue: (issue: WizardIssue) =>
			setDraft((current) => withIssueAdded(current, issue)),
		clearRepository: () => setDraft(withRepositoryCleared),
		draft,
		removeIssue: (issueNumber: number) =>
			setDraft((current) => withIssueRemoved(current, issueNumber)),
		reset: () => setDraft(EMPTY_WIZARD_DRAFT),
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

export type WizardDraftApi = ReturnType<typeof useWizardDraft>;

/** Start (§8.5, client side): one atomic create → close the modal and
 * navigate into the Task Conversation; a rejected Start surfaces the
 * server's real error as a toast and leaves the wizard exactly where it
 * was — modal open, draft intact. */
function useStartTask(draft: WizardDraft, onStarted: () => void) {
	const navigate = useNavigate();
	const create = useMutation(
		orpc.tasks.create.mutationOptions({
			onSuccess: ({ taskId }: { taskId: string }) => {
				onStarted();
				navigate({ params: { taskId }, to: "/tasks/$taskId" });
			},
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
	wizard: WizardDraftApi;
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

/** Fixed-order step position + the Step 2 required-field gate; validation
 * messages only appear after an attempted advance (errorsVisible). */
function useStepNavigation(draft: WizardDraft) {
	const [stepIndex, setStepIndex] = useState(0);
	const [errorsVisible, setErrorsVisible] = useState(false);
	const step: WizardStep = WIZARD_STEPS[stepIndex] ?? "runtime";
	const goBack = () => setStepIndex((index) => Math.max(index - 1, 0));
	const goNext = () => {
		if (step === "request" && !requestStepComplete(draft)) {
			setErrorsVisible(true);
			return;
		}
		setStepIndex((index) => Math.min(index + 1, WIZARD_STEPS.length - 1));
	};
	return { errorsVisible, goBack, goNext, step };
}

/** Step indicator pinned above and Back/Next/Start pinned below a scrolling
 * step body — inside the modal only the middle region ever scrolls. */
function WizardBody({
	computers,
	onStarted,
	wizard,
}: {
	computers: ComputerListItem[];
	onStarted: () => void;
	wizard: WizardDraftApi;
}) {
	const { errorsVisible, goBack, goNext, step } = useStepNavigation(
		wizard.draft
	);
	const { start, starting } = useStartTask(wizard.draft, onStarted);
	const computer = computers.find(
		(item) => item.id === wizard.draft.computerId
	);
	const runtime = selectedRuntime(computer, wizard.draft.agentKind);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4">
			<div className="px-4">
				<StepIndicator current={step} />
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4">
				<StepContent
					computers={computers}
					errorsVisible={errorsVisible}
					step={step}
					wizard={wizard}
				/>
			</div>
			<div className="px-4 pb-4">
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
		</div>
	);
}

/** The wizard panel the New Task modal hosts: loads the computer list, then
 * hands the three steps to WizardBody. The horizontal padding lives here
 * because the modal shell keeps its content edge-to-edge so only the step
 * body scrolls. */
export function NewTaskWizard({
	onStarted,
	wizard,
}: {
	onStarted: () => void;
	wizard: WizardDraftApi;
}) {
	const query = useQuery({
		...orpc.computers.list.queryOptions(),
		refetchInterval: LIST_REFETCH_INTERVAL_MS,
	});
	if (query.isPending) {
		return (
			<div className="flex flex-col gap-4 px-4 pb-4">
				<Skeleton className="h-6 w-56" />
				<Skeleton className="h-40 w-full rounded-xl" />
			</div>
		);
	}
	const computers = query.data ?? [];
	if (computers.length === 0) {
		return (
			<div className="px-4 pb-4">
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
			</div>
		);
	}
	return (
		<WizardBody computers={computers} onStarted={onStarted} wizard={wizard} />
	);
}
