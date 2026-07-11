import { Button } from "@better-agent/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@better-agent/ui/components/card";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import type { QuestionEvent, QuestionItem } from "./bridge-events";

const NO_SELECTION = -1;

interface QuestionRowProps {
	answeredLabel?: string;
	disabled: boolean;
	onChoose: (optionIndex: number) => void;
	picked: number;
	question: QuestionItem;
}

/** One question's text plus its single-select option buttons — split out of
 * `QuestionCard` purely to keep that component under the repo's
 * max-lines-per-function gate. Mirrors `ApprovalLine`'s option-button row. */
function QuestionRow({
	answeredLabel,
	disabled,
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
							key={option}
							onClick={() => onChoose(optionIndex)}
							size="sm"
							type="button"
							variant={chosen ? "default" : "outline"}
						>
							{chosen && <CheckIcon className="size-3.5" />}
							{option}
						</Button>
					);
				})}
			</div>
		</div>
	);
}

/** Builds the `string[][]` payload `onAnswer` sends — one single-element
 * array per question, in question order. Split out of `QuestionCard` purely
 * to keep that component under the repo's max-lines-per-function gate. */
function buildAnswers(questions: QuestionItem[], picks: number[]): string[][] {
	return questions.map((question, index) => [question.options[picks[index]]]);
}

export interface QuestionCardProps {
	/** This request's already-submitted answers, one array per question in the
	 * same order as `event.questions` — set either from this session's own
	 * submit (optimistically, before the round trip settles — see
	 * `makeAnswerQuestion`) or a replayed event for an already-answered
	 * `requestId`. Mirrors `ApprovalLineProps.answeredOptionId`. */
	answered?: string[][];
	event: QuestionEvent;
	onAnswer?: (requestId: string, answers: string[][]) => void;
}

/**
 * R3-T3: opencode's `question.asked` card — one or more questions, each with
 * single-select option buttons, stacked in order. A Submit button (disabled
 * until every question has a pick) sends the chosen answers back as
 * `string[][]` — one single-element array per question, mirroring the CLI's
 * `ControlAnswerQuestionCommand.answers`. Once `answered` is set the whole
 * card disables and shows the previously-chosen option per question, exactly
 * like `ApprovalLine` does for `answeredOptionId`.
 */
export function QuestionCard({ answered, event, onAnswer }: QuestionCardProps) {
	const [picks, setPicks] = useState<number[]>(() =>
		event.questions.map(() => NO_SELECTION)
	);
	const disabled = answered !== undefined;
	const allPicked = picks.every((pick) => pick !== NO_SELECTION);

	const choose = (questionIndex: number, optionIndex: number): void => {
		setPicks((prev) =>
			prev.map((pick, index) => (index === questionIndex ? optionIndex : pick))
		);
	};

	const submit = (): void => {
		if (allPicked) {
			onAnswer?.(event.requestId, buildAnswers(event.questions, picks));
		}
	};

	return (
		<Card className="gap-3 font-sans" size="sm">
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5">
					<span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
					{event.title}
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{event.questions.map((question, questionIndex) => (
					<QuestionRow
						answeredLabel={answered?.[questionIndex]?.[0]}
						disabled={disabled}
						key={question.text}
						onChoose={(optionIndex) => choose(questionIndex, optionIndex)}
						picked={picks[questionIndex]}
						question={question}
					/>
				))}
				<Button
					className="self-start"
					disabled={disabled || !allPicked}
					onClick={submit}
					size="sm"
					type="button"
				>
					Submit
				</Button>
			</CardContent>
		</Card>
	);
}
