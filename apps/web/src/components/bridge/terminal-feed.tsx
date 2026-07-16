import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import { RevealText } from "@better-agent/ui/components/chat/reveal-text";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@better-agent/ui/components/message-scroller";
import { type ReactNode, useEffect, useState } from "react";
import { formatElapsed } from "./activity-format";
import { BridgeChatRow } from "./bridge-chat-row";
import type { BridgeTurn } from "./bridge-turns";

// The scrolling conversation surface for a Local Agent session, split out of
// terminal.tsx to keep that file under the repo's max-lines-per-file gate: the
// turn list plus the persistent "working" row (see `WorkingSkeleton`).

function EmptyTerminal() {
	return (
		<div className="flex flex-col items-center justify-center py-24 text-center">
			<RevealText>
				<p className="t-stagger-line t-stagger-line--1 font-medium text-sm">
					No output yet — waiting for the agent…
				</p>
				<p className="t-stagger-line t-stagger-line--2 text-muted-foreground text-sm">
					Send a message to begin.
				</p>
			</RevealText>
		</div>
	);
}

/** A persistent assistant-message-shaped placeholder — an avatar dot plus the
 * same shimmering "Thinking…" text the main chat's `ChatRow` (packages/ui)
 * shows while a live draft has no blocks yet — pinned to the bottom of the
 * feed for the WHOLE in-flight turn (from the user's send until
 * `turn_usage`/`turn_end`), so a long tool run never looks frozen. R1-T1:
 * replaces the old moving-bars skeleton (`.working-shimmer`, now unused —
 * deleted from index.css) so the web's two "still producing" placeholders
 * (this one, and `StreamingSkeleton` in bridge-chat-row.tsx) read as the same
 * visual language. */
/** P1-T5: the shimmer verb rotates on a slow cycle and an elapsed counter
 * ticks up beside it, so a minutes-long turn reads as alive rather than
 * frozen. Both derive from one interval keyed to this mount — the skeleton
 * mounts when the turn starts and unmounts when it settles. */
const WORKING_VERBS = ["Thinking…", "Working…", "Reasoning…", "Still at it…"];
const VERB_ROTATE_MS = 6000;
const TICK_MS = 1000;

function WorkingSkeleton() {
	const [elapsedMs, setElapsedMs] = useState(0);
	useEffect(() => {
		const startedAt = Date.now();
		const timer = setInterval(
			() => setElapsedMs(Date.now() - startedAt),
			TICK_MS
		);
		return () => clearInterval(timer);
	}, []);
	const verb =
		WORKING_VERBS[
			Math.floor(elapsedMs / VERB_ROTATE_MS) % WORKING_VERBS.length
		];
	return (
		<div
			aria-label="Agent is working"
			className="flex items-center gap-3 px-1 py-3"
			data-testid="working-skeleton"
			role="status"
		>
			<div className="size-7 shrink-0 rounded-full bg-muted" />
			<span className="shimmer font-medium text-sm">{verb}</span>
			{elapsedMs >= TICK_MS && (
				<span className="text-muted-foreground text-xs tabular-nums">
					{formatElapsed(elapsedMs)}
				</span>
			)}
		</div>
	);
}

export interface TerminalFeedProps {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	answeredQuestions: Record<string, string[][]>;
	/** R3-T3: mirrors `answerApproval`/`answered` for a `question` turn. */
	answerQuestion: (requestId: string, answers: string[][]) => Promise<void>;
	avatars: ChatAvatars;
	ended: boolean;
	/** S3-T2: rendered INSIDE the scroller before the first turn — the Task
	 * Conversation page mounts the Opening Message here so it scrolls with the
	 * feed as its literal first message. Also suppresses the "No output yet"
	 * empty state (a task run's feed is never conversationally empty). */
	leading?: ReactNode;
	/** True for the entire in-flight turn — keeps the working skeleton visible
	 * throughout, not just before the first token. */
	turnInFlight: boolean;
	turns: BridgeTurn[];
}

/** The trailing assistant turn that's still open (`state.current` at fold
 * time) is the message currently being produced. When the turn is in flight,
 * the shimmer skeleton attaches to THIS message (rendered inside the same
 * scroller item, tucked under its text) instead of a disconnected row at the
 * bottom of the feed — so the "still outputting" hint reads as part of the
 * message itself. Only attaches when the message already has prose (text/
 * reasoning); a turn that's only a running tool stays on the floating avatar
 * skeleton (shimmer lines under a bare tool card would read wrong). Split out
 * of `TerminalFeed` purely to keep that component under the repo's
 * max-lines-per-function gate. */
function attachSkeletonTurnId(turns: BridgeTurn[]): number | null {
	const lastTurn = turns.at(-1);
	if (
		lastTurn === undefined ||
		lastTurn.kind !== "assistant" ||
		!lastTurn.streaming
	) {
		return null;
	}
	const hasProse = lastTurn.blocks.some(
		(block) => block.kind === "text" || block.kind === "reasoning"
	);
	return hasProse ? lastTurn.id : null;
}

/** The turn kinds that render on the assistant spine (see `BridgeChatRow`'s
 * `pl-9` + `border-l pl-3` wrapper) rather than as their own avatar bubble:
 * the status/error/file lines and the task/plan cards. Used to pull these
 * items up so their spine bridges the feed's `gap-6` and reads as a
 * continuation of the preceding assistant turn instead of a line-broken
 * block. Approval/question requests are NOT here — they fold INTO the
 * assistant turn as blocks (see bridge-turns-approval.ts). */
const SIDE_TURN_KINDS = new Set(["status", "error", "file", "task", "plan"]);

/** The scrolling conversation: bridge turns rendered as chat bubbles/lines. */
export function TerminalFeed({
	answerApproval,
	answered,
	answerQuestion,
	answeredQuestions,
	avatars,
	ended,
	leading,
	turnInFlight,
	turns,
}: TerminalFeedProps) {
	// The floating avatar skeleton covers pure waiting (before any assistant
	// message exists) and a turn that's only a running tool; see
	// `attachSkeletonTurnId` for when it attaches to a message instead.
	const attachToId = attachSkeletonTurnId(turns);
	const showFloatingSkeleton = turnInFlight && attachToId === null;

	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
						{leading && <MessageScrollerItem>{leading}</MessageScrollerItem>}
						{turns.length === 0 && !turnInFlight
							? !leading && <EmptyTerminal />
							: turns.map((turn, index) => {
									// A spine turn attaches up to the previous item, cancelling
									// the feed's `gap-6`, so its `border-l` spine meets the
									// preceding turn's spine instead of leaving a line-breaking
									// gap. Skipped for the first item (nothing above to meet).
									const attachUp =
										index > 0 && SIDE_TURN_KINDS.has(turn.kind)
											? "-mt-6"
											: undefined;
									return (
										<MessageScrollerItem className={attachUp} key={turn.id}>
											<BridgeChatRow
												answered={answered}
												answeredQuestions={answeredQuestions}
												attachSkeleton={turnInFlight && turn.id === attachToId}
												avatars={avatars}
												ended={ended}
												onAnswerApproval={answerApproval}
												onAnswerQuestion={answerQuestion}
												turn={turn}
											/>
										</MessageScrollerItem>
									);
								})}
						{showFloatingSkeleton && <WorkingSkeleton />}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}
