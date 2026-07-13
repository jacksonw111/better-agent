import { Button } from "@better-agent/ui/components/button";
import { CheckIcon, ChevronLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { QuestionEvent, QuestionItem } from "./bridge-events";

// P1-T4: QuestionCard's presentational halves — the pending multi-question
// wizard and the stacked single/replay layout — split out of question-card.tsx
// purely to keep that file under the repo's 300-line cap. All state stays in
// question-card.tsx.

export const NO_SELECTION = -1;

/** Digit shortcuts cover options 1-9 only — a tenth-plus option is still
 * clickable, it just has no key. (The question data has no free-text flag, so
 * there is no 0=Other shortcut — see `QuestionItem`.) */
export const MAX_DIGIT_OPTIONS = 9;

interface QuestionRowProps {
	answeredLabel?: string;
	disabled: boolean;
	/** P1-T4: show a small 1-9 hint per option (pending cards only) so the
	 * digit-key shortcuts are discoverable. */
	numbered?: boolean;
	onChoose: (optionIndex: number) => void;
	picked: number;
	question: QuestionItem;
}

/** One question's text plus its single-select option buttons. Mirrors
 * `ApprovalLine`'s option-button row. */
function QuestionRow({
	answeredLabel,
	disabled,
	numbered,
	onChoose,
	picked,
	question,
}: QuestionRowProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<p className="text-sm">{question.text}</p>
			<div className="flex flex-wrap gap-2">
				{question.options.map((option, optionIndex) => {
					const chosen = disabled
						? answeredLabel === option
						: picked === optionIndex;
					return (
						<Button
							aria-pressed={chosen}
							disabled={disabled}
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed snapshot from one event, never reordered — index only disambiguates two options sharing a label (R3-4 finding 5)
							key={`${optionIndex}-${option}`}
							onClick={() => onChoose(optionIndex)}
							size="sm"
							type="button"
							variant={chosen ? "default" : "outline"}
						>
							{chosen && <CheckIcon className="size-3.5" />}
							{numbered && optionIndex < MAX_DIGIT_OPTIONS && (
								<span aria-hidden className="text-xs tabular-nums opacity-60">
									{optionIndex + 1}
								</span>
							)}
							{option}
						</Button>
					);
				})}
			</div>
		</div>
	);
}

function dotClass(index: number, current: number): string {
	if (index === current) {
		return "bg-primary";
	}
	return index < current ? "bg-primary/50" : "bg-muted-foreground/25";
}

/** The wizard's step indicator: one dot per question (filled = current,
 * half = done, faint = upcoming) plus a "2/3" counter. */
function ProgressDots({ current, total }: { current: number; total: number }) {
	return (
		<div className="flex items-center gap-2" data-slot="question-progress">
			<div aria-hidden className="flex items-center gap-1">
				{Array.from({ length: total }, (_, index) => (
					<span
						className={`size-1.5 rounded-full transition-colors ${dotClass(index, current)}`}
						// biome-ignore lint/suspicious/noArrayIndexKey: dots ARE positions — there is nothing else to key on
						key={index}
					/>
				))}
			</div>
			<span className="text-muted-foreground text-xs tabular-nums">
				{current + 1}/{total}
			</span>
		</div>
	);
}

/** The shared amber-dot title strip (borderless, per the de-carded 9040e71
 * language) with an optional right-aligned slot for the wizard's progress. */
function CardHeader({ right, title }: { right?: ReactNode; title: string }) {
	return (
		<div className="flex items-center justify-between gap-2 px-3 pt-2">
			<p className="flex items-center gap-1.5 font-medium text-sm">
				<span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
				{title}
			</p>
			{right}
		</div>
	);
}

interface WizardCardProps {
	allPicked: boolean;
	event: QuestionEvent;
	lastStep: boolean;
	onAdvance: () => void;
	onBack: () => void;
	onChoose: (optionIndex: number) => void;
	picks: number[];
	step: number;
}

/** P1-T4: the one-question-per-screen wizard used while a MULTI-question card
 * is still pending — progress dots up top, Back to revisit, Next/Submit to
 * advance. Mirrors claudecodeui's AskUserQuestionPanel (research doc §3.4). */
export function WizardCard({
	allPicked,
	event,
	lastStep,
	onAdvance,
	onBack,
	onChoose,
	picks,
	step,
}: WizardCardProps) {
	const advanceDisabled =
		picks[step] === NO_SELECTION || (lastStep && !allPicked);
	return (
		<div className="overflow-hidden rounded-md bg-muted/40 font-sans">
			<CardHeader
				right={<ProgressDots current={step} total={event.questions.length} />}
				title={event.title}
			/>
			<div className="flex flex-col gap-2 px-3 py-2">
				<QuestionRow
					disabled={false}
					numbered
					onChoose={onChoose}
					picked={picks[step]}
					question={event.questions[step]}
				/>
				<div className="flex items-center gap-2">
					{step > 0 && (
						<Button onClick={onBack} size="sm" type="button" variant="ghost">
							<ChevronLeftIcon className="size-3.5" />
							Back
						</Button>
					)}
					<Button
						disabled={advanceDisabled}
						onClick={onAdvance}
						size="sm"
						type="button"
					>
						{lastStep ? "Submit" : "Next"}
					</Button>
				</div>
			</div>
		</div>
	);
}

interface StackedCardProps {
	answered?: string[][];
	disabled: boolean;
	event: QuestionEvent;
	numbered: boolean;
	onChoose: (questionIndex: number, optionIndex: number) => void;
	onSubmit: () => void;
	picks: number[];
	submitDisabled: boolean;
}

/** The pre-P1-T4 stacked layout, kept for a pending SINGLE-question card and
 * for every answered card's read-only replay (all questions visible with
 * their chosen options, exactly as before). */
export function StackedCard({
	answered,
	disabled,
	event,
	numbered,
	onChoose,
	onSubmit,
	picks,
	submitDisabled,
}: StackedCardProps) {
	return (
		<div className="overflow-hidden rounded-md bg-muted/40 font-sans">
			<CardHeader title={event.title} />
			<div className="flex flex-col gap-2 px-3 py-2">
				{event.questions.map((question, questionIndex) => (
					<QuestionRow
						answeredLabel={answered?.[questionIndex]?.[0]}
						disabled={disabled}
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed snapshot from one event, never reordered — index only disambiguates two questions sharing text (R3-4 finding 5)
						key={`${questionIndex}-${question.text}`}
						numbered={numbered}
						onChoose={(optionIndex) => onChoose(questionIndex, optionIndex)}
						picked={picks[questionIndex]}
						question={question}
					/>
				))}
				<Button
					className="self-start"
					disabled={submitDisabled}
					onClick={onSubmit}
					size="sm"
					type="button"
				>
					Submit
				</Button>
			</div>
		</div>
	);
}
