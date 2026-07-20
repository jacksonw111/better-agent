import { type Dispatch, useEffect, useRef, useState } from "react";
import type { BridgeTransport } from "./bridge-transport";
import { createSendOutbox, mintOutboxKey } from "./send-outbox";
import { registerSendOutboxActions } from "./send-outbox-store";
import type { OutboxEntry, SendOutbox } from "./send-outbox-types";
import type { FeedAction } from "./use-bridge-feed";

// fix-send-outbox: the React binding around `createSendOutbox` — the queue
// itself (retries, ordering, persistence, idempotency) lives in send-outbox.ts
// and is tested there as plain async code. This file only owns the lifecycle:
// one outbox per session, its status updates dispatched into the feed, its
// retry/discard actions published for the message rows, and a restored queue
// resumed on mount.

/** Fire-and-forget for a drain kicked off from an effect/handler — the outbox
 * reports every outcome through the feed or the enqueue promise, so there is
 * nothing here to await. */
function ignoreOutboxDrain(promise: Promise<void>): void {
	promise.catch(() => undefined);
}

export interface UseSendOutboxResult {
	/** Queues a CONTROL command (approval decision, interrupt, setModel, …):
	 * no chat echo, and the returned promise still rejects on final failure so
	 * the existing rollback-and-toast call sites keep working. */
	enqueueControl: (data: unknown) => Promise<void>;
	/** Queues a CHAT message: echoes it into the feed under the same key the
	 * send carries, so the line tracks its own delivery. Never rejects — the
	 * failure shows up on the line itself. */
	enqueueMessage: (data: unknown, echoText: string) => Promise<void>;
	/** True while anything is queued or in flight (a failed entry awaiting the
	 * user's decision does NOT count — nothing is being attempted). */
	sending: boolean;
}

function isBusy(entries: OutboxEntry[]): boolean {
	return entries.some((entry) => entry.status !== "failed");
}

/** Builds this session's outbox exactly once (recreated when the session
 * changes): `dispatchFeed` and the transport are read through refs so a
 * re-render never rebuilds the queue and loses whatever is in flight. */
function useOutbox(
	sessionId: string,
	transport: BridgeTransport,
	dispatchFeed: Dispatch<FeedAction>,
	setEntries: (entries: OutboxEntry[]) => void
): SendOutbox {
	const transportRef = useRef(transport);
	transportRef.current = transport;
	const dispatchRef = useRef(dispatchFeed);
	dispatchRef.current = dispatchFeed;
	const outboxRef = useRef<{ outbox: SendOutbox; sessionId: string } | null>(
		null
	);
	if (outboxRef.current?.sessionId !== sessionId) {
		outboxRef.current = {
			sessionId,
			outbox: createSendOutbox({
				onChange: setEntries,
				onStatus: (key, status) =>
					dispatchRef.current({ type: "echoStatus", key, status }),
				send: (args) => transportRef.current.sendInput(args),
				sessionId,
			}),
		};
	}
	return outboxRef.current.outbox;
}

/**
 * Restores whatever this session's previous page load left undelivered: the
 * echoes are re-created in the feed (the feed itself is rebuilt from server
 * history, which by definition does NOT contain a message that never arrived)
 * and the drain resumes. Every restored send carries its original idempotency
 * key, so a message that HAD reached the server before the reload is deduped
 * there rather than delivered twice.
 */
function useRestoreOutbox(
	outbox: SendOutbox,
	dispatchFeed: Dispatch<FeedAction>,
	setEntries: (entries: OutboxEntry[]) => void
): void {
	useEffect(() => {
		for (const entry of outbox.entries()) {
			if (entry.echoText !== undefined) {
				dispatchFeed({
					type: "localEcho",
					text: entry.echoText,
					sendKey: entry.key,
				});
			}
		}
		setEntries(outbox.entries());
		ignoreOutboxDrain(outbox.drain());
		// `dispatchFeed` from `useReducer` is stable; the outbox is stable per
		// session — so this runs once per session, which is the intent.
	}, [outbox, dispatchFeed, setEntries]);
}

export function useSendOutbox(
	sessionId: string,
	transport: BridgeTransport,
	dispatchFeed: Dispatch<FeedAction>
): UseSendOutboxResult {
	const [entries, setEntries] = useState<OutboxEntry[]>([]);
	const outbox = useOutbox(sessionId, transport, dispatchFeed, setEntries);
	useRestoreOutbox(outbox, dispatchFeed, setEntries);
	useEffect(
		() =>
			registerSendOutboxActions({
				discard: (key) => outbox.discard(key),
				retry: (key) => ignoreOutboxDrain(outbox.retry(key)),
			}),
		[outbox]
	);
	return {
		enqueueControl: (data) => outbox.enqueue({ data }),
		enqueueMessage: (data, echoText) => {
			// The key is minted HERE, not inside `enqueue`, because the echo has to
			// carry it: that is what ties the rendered line to its queue entry.
			const key = mintOutboxKey();
			dispatchFeed({ type: "localEcho", text: echoText, sendKey: key });
			return outbox.enqueue({ data, echoText, key });
		},
		sending: isBusy(entries),
	};
}
