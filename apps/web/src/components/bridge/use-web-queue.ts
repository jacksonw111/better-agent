import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImageRef } from "./use-image-attachments";

// P2-T5: the WEB-side editable busy queue. When a turn is in flight and the
// user submits with the default "queue" policy, the composer holds the
// message HERE (editable/deletable cards, see web-queue-cards.tsx) instead of
// relaying it for the CLI/agent to queue natively — native busy-queueing is
// opaque (can't edit or drop a queued line). On the busy→idle transition the
// whole batch flushes FIFO through the ordinary send path. pi's own
// `queue_update` count (bridge-queue-status.ts) reflects the AGENT-side
// queue and stays a separate read-only chip; steer/interrupt sends bypass
// this queue entirely and go out immediately.

export interface WebQueueItem {
	id: string;
	/** P3-T2: already-uploaded image refs snapshotted at queue time; flushed
	 * with the text so a queued send keeps its attachments. */
	images?: ImageRef[];
	queuedAt: number;
	text: string;
	/** Snapshotted at queue time — the web queue only ever holds the default
	 * "queue" policy (steer/interrupt submits send immediately instead). */
	when: "queue";
}

export interface WebQueue {
	enqueue: (text: string, images?: ImageRef[]) => void;
	items: WebQueueItem[];
	remove: (id: string) => void;
}

export interface UseWebQueueArgs {
	/** The session is over — queued items can never be delivered, so they're
	 * dropped (with a toast) rather than silently lost. */
	ended: boolean;
	/** The ordinary chat send (`useBridgeTerminal`'s `sendInput` — bare text,
	 * plus the item's snapshotted image refs when it has any). */
	send: (
		text: string,
		when?: undefined,
		images?: ImageRef[]
	) => void | Promise<void>;
	/** The bridge session ROW id (stable per session) — a switch drops the
	 * queue so items never leak into another session's conversation. */
	sessionId: string;
	turnInFlight: boolean;
}

type SetItems = Dispatch<SetStateAction<WebQueueItem[]>>;
type ItemsRef = RefObject<WebQueueItem[]>;

const QUEUE_SEND_FAILURE_MESSAGE = "排队消息发送失败";

/** Empties the queue outright (session switched away or ended), toasting how
 * many pending messages were dropped so the loss is never silent. */
function dropAll(itemsRef: ItemsRef, setItems: SetItems): void {
	const dropped = itemsRef.current.length;
	if (dropped === 0) {
		return;
	}
	itemsRef.current = [];
	setItems([]);
	toast.warning(`已丢弃 ${dropped} 条待发送消息`);
}

/** Flushes ONE batch: snapshots the current items, clears the queue
 * synchronously (so anything enqueued while the sends are in flight lands in
 * a fresh queue and goes out — in order — on the NEXT busy→idle transition),
 * then sends the snapshot FIFO. Robust to rapid busy flapping: a second
 * transition mid-flush just sees an empty (or freshly-refilled) queue. */
function flush(
	itemsRef: ItemsRef,
	setItems: SetItems,
	send: UseWebQueueArgs["send"]
): void {
	const batch = itemsRef.current;
	if (batch.length === 0) {
		return;
	}
	itemsRef.current = [];
	setItems([]);
	const sendAll = async () => {
		for (const item of batch) {
			// Arity-preserving: an image-less item calls `send` exactly like the
			// pre-P3-T2 flush did, so callers/fakes asserting call shapes hold.
			if (item.images) {
				await send(item.text, undefined, item.images);
			} else {
				await send(item.text);
			}
		}
	};
	sendAll().catch(() => {
		toast.error(QUEUE_SEND_FAILURE_MESSAGE);
	});
}

/** The lifecycle effect: drop on session switch/end, flush on the busy→idle
 * falling edge — one effect (not one per input) so "session changed" always
 * wins over a simultaneous busy-flag change and a stale flush can never fire
 * into the new session. Split out of `useWebQueue` purely to keep it under
 * the repo's max-lines-per-function gate. */
function useQueueLifecycle(
	args: UseWebQueueArgs,
	itemsRef: ItemsRef,
	setItems: SetItems
): void {
	const { ended, send, sessionId, turnInFlight } = args;
	const prevRef = useRef({ sessionId, turnInFlight });
	const sendRef = useRef(send);
	sendRef.current = send;
	useEffect(() => {
		const prev = prevRef.current;
		prevRef.current = { sessionId, turnInFlight };
		if (prev.sessionId !== sessionId || ended) {
			dropAll(itemsRef, setItems);
			return;
		}
		if (prev.turnInFlight && !turnInFlight) {
			flush(itemsRef, setItems, sendRef.current);
		}
	}, [ended, itemsRef, sessionId, setItems, turnInFlight]);
}

let nextItemId = 0;

/**
 * Owns the web-side busy queue for one terminal: `enqueue` snapshots
 * `{text, when: "queue", queuedAt}` at queue time, `remove` deletes (also
 * how "edit" works — the card's pencil loads the text back into the composer
 * and removes the item), and the busy→idle transition auto-flushes FIFO via
 * `send`. Items live in React state only (deliberately not persisted): a
 * reload reconnects to whatever the agent is doing anyway.
 */
export function useWebQueue(args: UseWebQueueArgs): WebQueue {
	const [items, setItems] = useState<WebQueueItem[]>([]);
	const itemsRef = useRef<WebQueueItem[]>(items);
	useQueueLifecycle(args, itemsRef, setItems);

	const enqueue = (text: string, images?: ImageRef[]) => {
		nextItemId += 1;
		const item: WebQueueItem = {
			id: `wq-${nextItemId}`,
			queuedAt: Date.now(),
			text,
			when: "queue",
		};
		if (images && images.length > 0) {
			item.images = images;
		}
		itemsRef.current = [...itemsRef.current, item];
		setItems(itemsRef.current);
	};

	const remove = (id: string) => {
		itemsRef.current = itemsRef.current.filter((item) => item.id !== id);
		setItems(itemsRef.current);
	};

	return { enqueue, items, remove };
}
