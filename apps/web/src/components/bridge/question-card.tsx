import type { QuestionBlockData } from "@better-agent/ui/components/chat/chat-blocks";
import { useCallback, useEffect, useState } from "react";
import {
	MAX_DIGIT_OPTIONS,
	NO_SELECTION,
	StackedCard,
	WizardCard,
} from "./question-card-views";

/** Builds the `string[][]` payload `onAnswer` sends — one single-element
 * array per question, in question order. */
function buildAnswers(
	questions: QuestionBlockData["questions"],
	picks: number[]
): string[][] {
	return questions.map((question, index) => [question.options[picks[index]]]);
}

/** `true` when the key press happened inside a text-entry control (the
 * composer, a dialog input…) — the card's document-level shortcuts must never
 * hijack typing. */
function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target.isContentEditable
	);
}

interface QuestionKeyHandlers {
	enabled: boolean;
	onDigit: (optionIndex: number) => void;
	onEnter: () => void;
}

/** P1-T4 keyboard layer: digits 1-9 pick the current question's option,
 * Enter advances to the next question (or submits on the last). Document-
 * level so the card doesn't need focus; only armed while the card is still
 * pending, and inert while typing in an input or holding a modifier. */
function useQuestionKeys({
	enabled,
	onDigit,
	onEnter,
}: QuestionKeyHandlers): void {
	useEffect(() => {
		if (!enabled) {
			return () => {
				// nothing to clean up: no listener was attached
			};
		}
		const onKeyDown = (keyEvent: KeyboardEvent) => {
			const modified = keyEvent.metaKey || keyEvent.ctrlKey || keyEvent.altKey;
			if (isEditableTarget(keyEvent.target) || modified) {
				return;
			}
			if (keyEvent.key === "Enter") {
				keyEvent.preventDefault();
				onEnter();
				return;
			}
			const digit = Number.parseInt(keyEvent.key, 10);
			if (digit >= 1 && digit <= MAX_DIGIT_OPTIONS) {
				keyEvent.preventDefault();
				onDigit(digit - 1);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [enabled, onDigit, onEnter]);
}

export interface QuestionCardProps {
	/** This request's already-submitted answers, one array per question in the
	 * same order as `event.questions` — set either from this session's own
	 * submit (optimistically, before the round trip settles — see
	 * `makeAnswerQuestion`) or a replayed event for an already-answered
	 * `requestId`. Mirrors `ApprovalLineProps.answeredOptionId`. */
	answered?: string[][];
	event: QuestionBlockData;
	onAnswer?: (requestId: string, answers: string[][]) => void;
}

/** `QuestionCard`'s picks/step state plus every derived callback — split out
 * of the component purely to keep it under the repo's max-lines-per-function
 * gate. */
function useQuestionCardState(
	event: QuestionBlockData,
	onAnswer: QuestionCardProps["onAnswer"]
) {
	const [picks, setPicks] = useState<number[]>(() =>
		event.questions.map(() => NO_SELECTION)
	);
	const [step, setStep] = useState(0);
	const lastStep = step >= event.questions.length - 1;
	const choose = useCallback((questionIndex: number, optionIndex: number) => {
		setPicks((prev) =>
			prev.map((pick, index) => (index === questionIndex ? optionIndex : pick))
		);
	}, []);
	const submit = useCallback(() => {
		if (picks.every((pick) => pick !== NO_SELECTION)) {
			onAnswer?.(event.requestId, buildAnswers(event.questions, picks));
		}
	}, [event.questions, event.requestId, onAnswer, picks]);
	const advance = useCallback(() => {
		if (picks[step] === NO_SELECTION) {
			return;
		}
		if (lastStep) {
			submit();
			return;
		}
		setStep((prev) => prev + 1);
	}, [lastStep, picks, step, submit]);
	const back = useCallback(() => setStep((prev) => Math.max(prev - 1, 0)), []);
	const pickByDigit = useCallback(
		(optionIndex: number) => {
			if (optionIndex < event.questions[step].options.length) {
				choose(step, optionIndex);
			}
		},
		[choose, event.questions, step]
	);
	return { advance, back, choose, lastStep, pickByDigit, picks, step, submit };
}

/**
 * R3-T3: opencode's `question.asked` card. P1-T4 upgrades a pending
 * MULTI-question card into a step-by-step wizard (one question per screen,
 * progress dots, Back); a single-question card and every answered replay keep
 * the original stacked layout. Digits 1-9 pick an option, Enter advances /
 * submits. Answers still go back as `string[][]` — one single-element array
 * per question, mirroring the CLI's `ControlAnswerQuestionCommand.answers`;
 * no protocol change.
 */
export function QuestionCard({ answered, event, onAnswer }: QuestionCardProps) {
	const disabled = answered !== undefined;
	const { advance, back, choose, lastStep, pickByDigit, picks, step, submit } =
		useQuestionCardState(event, onAnswer);
	const allPicked = picks.every((pick) => pick !== NO_SELECTION);
	useQuestionKeys({
		enabled: !disabled,
		onDigit: pickByDigit,
		onEnter: advance,
	});

	if (!disabled && event.questions.length > 1) {
		return (
			<WizardCard
				allPicked={allPicked}
				event={event}
				lastStep={lastStep}
				onAdvance={advance}
				onBack={back}
				onChoose={(optionIndex) => choose(step, optionIndex)}
				picks={picks}
				step={step}
			/>
		);
	}
	return (
		<StackedCard
			answered={answered}
			disabled={disabled}
			event={event}
			numbered={!disabled}
			onChoose={choose}
			onSubmit={submit}
			picks={picks}
			submitDisabled={disabled || !allPicked}
		/>
	);
}
