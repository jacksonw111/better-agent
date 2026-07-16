import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import type { WizardStep } from "./wizard-state";
import { WIZARD_STEPS } from "./wizard-state";

// The wizard's frame pieces — step indicator and Back/Next/Start footer —
// split from new-task-wizard.tsx purely to keep that file under the repo's
// size gate. The fixed Runtime → Request → GitHub order and the no-Review
// direct Start are product contract (master spec §18.2).

const STEP_TITLES: Record<WizardStep, string> = {
	github: "GitHub",
	request: "Request",
	runtime: "Runtime",
};

export function StepIndicator({ current }: { current: WizardStep }) {
	return (
		<ol className="flex items-center gap-3 text-muted-foreground text-xs">
			{WIZARD_STEPS.map((step, index) => (
				<li
					aria-current={step === current ? "step" : undefined}
					className={cn(
						"flex items-center gap-1.5",
						step === current && "font-medium text-foreground"
					)}
					key={step}
				>
					<span
						className={cn(
							"flex size-5 items-center justify-center rounded-full text-[10px]",
							step === current
								? "bg-primary text-primary-foreground"
								: "bg-muted"
						)}
					>
						{index + 1}
					</span>
					{STEP_TITLES[step]}
				</li>
			))}
		</ol>
	);
}

/** Start button + the offline gate: an offline computer is viewable through
 * every step, but never a launch target (spec §8.2/§8.5). */
function StartControls({
	computerOffline,
	onStart,
	starting,
}: {
	computerOffline: boolean;
	onStart: () => void;
	starting: boolean;
}) {
	return (
		<div className="flex flex-col items-end gap-1.5">
			<Button
				disabled={computerOffline || starting}
				onClick={onStart}
				type="button"
			>
				{starting ? "Starting…" : "Start"}
			</Button>
			{computerOffline ? (
				<p className="text-destructive text-xs">
					This computer is offline — reconnect it or pick another one.
				</p>
			) : null}
		</div>
	);
}

export function WizardFooter({
	canAdvance,
	computerOffline,
	onBack,
	onNext,
	onStart,
	starting,
	step,
}: {
	canAdvance: boolean;
	computerOffline: boolean;
	onBack: () => void;
	onNext: () => void;
	onStart: () => void;
	starting: boolean;
	step: WizardStep;
}) {
	return (
		<div className="flex items-start justify-between gap-2">
			<Button
				disabled={step === "runtime"}
				onClick={onBack}
				type="button"
				variant="ghost"
			>
				Back
			</Button>
			{step === "github" ? (
				<StartControls
					computerOffline={computerOffline}
					onStart={onStart}
					starting={starting}
				/>
			) : (
				<Button
					disabled={step === "runtime" && !canAdvance}
					onClick={onNext}
					type="button"
				>
					Next
				</Button>
			)}
		</div>
	);
}
