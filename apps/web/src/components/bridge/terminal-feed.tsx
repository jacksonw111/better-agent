import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@better-agent/ui/components/message-scroller";
import { BridgeChatRow } from "./bridge-chat-row";
import type { BridgeTurn } from "./bridge-turns";

// The scrolling conversation surface for a Local Agent session, split out of
// terminal.tsx to keep that file under the repo's max-lines-per-file gate: the
// turn list plus the persistent "working" row (see `WorkingSkeleton`).

function EmptyTerminal() {
	return (
		<div className="flex flex-1 items-center justify-center py-24 text-center">
			<p className="text-muted-foreground text-sm">
				No output yet — waiting for the agent…
			</p>
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
function WorkingSkeleton() {
	return (
		<div
			aria-label="Agent is working"
			className="flex items-center gap-3 px-1 py-3"
			data-testid="working-skeleton"
			role="status"
		>
			<div className="size-7 shrink-0 rounded-full bg-muted" />
			<span className="shimmer font-medium text-sm">Thinking…</span>
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

/** The scrolling conversation: bridge turns rendered as chat bubbles/lines. */
export function TerminalFeed({
	answerApproval,
	answered,
	answerQuestion,
	answeredQuestions,
	avatars,
	ended,
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
						{turns.length === 0 && !turnInFlight ? (
							<EmptyTerminal />
						) : (
							turns.map((turn) => (
								<MessageScrollerItem key={turn.id}>
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
							))
						)}
						{showFloatingSkeleton && <WorkingSkeleton />}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}
