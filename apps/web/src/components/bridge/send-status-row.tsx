import { useSendOutboxActions } from "./send-outbox-store";

// fix-send-outbox: the delivery state of the user's OWN line, rendered under
// the bubble it belongs to. This is the visible half of the fix: before it, a
// message whose send failed still looked exactly like a delivered one.
//
// Right-aligned (`justify-end`) and padded past the avatar column (`pr-10` ≈
// size-8 avatar + row gap) so it tucks under the user bubble, which `ChatRow`
// renders with `align="end"`.

const ROW_CLASS =
	"flex items-center justify-end gap-2 pt-1 pr-10 text-xs leading-none";
const ACTION_CLASS =
	"rounded-sm px-1 py-0.5 underline-offset-2 transition-colors hover:underline";

export interface SendStatusRowProps {
	/** The send's idempotency key — what `retry`/`discard` address. */
	sendKey: string;
	status: "failed" | "sending" | "sent";
}

/** The queued/in-flight hint: deliberately quiet (a send in progress is the
 * normal case), and absent entirely once the send lands. */
function SendingHint() {
	return (
		<div className={ROW_CLASS}>
			<span className="text-muted-foreground">Sending…</span>
		</div>
	);
}

export function SendStatusRow({ sendKey, status }: SendStatusRowProps) {
	const actions = useSendOutboxActions();
	if (status === "sending") {
		return <SendingHint />;
	}
	if (status !== "failed") {
		// "sent" — an ordinary delivered line, nothing to say about it.
		return null;
	}
	return (
		<div className={ROW_CLASS} data-testid="send-failed">
			<span className="font-medium text-destructive">Not sent</span>
			<button
				className={`${ACTION_CLASS} text-foreground`}
				onClick={() => actions?.retry(sendKey)}
				type="button"
			>
				Retry
			</button>
			<button
				className={`${ACTION_CLASS} text-muted-foreground`}
				onClick={() => actions?.discard(sendKey)}
				type="button"
			>
				Discard
			</button>
		</div>
	);
}
