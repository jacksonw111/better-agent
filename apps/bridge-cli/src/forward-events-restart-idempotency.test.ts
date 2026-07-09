import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import { describe, expect, it } from "vitest";
import { forwardEvents, type QueuedEvent } from "./relay-client";

// FIX1 (rc-final-review): forward-events.test.ts / relay-client.test.ts only
// ever exercise forwardEvents against a bare `vi.fn()` `push` stub with no
// dedup logic of its own — so they could never have caught the bug this file
// covers. Here `push` goes all the way through the REAL relay store
// (`createInMemoryRelayStore` — the same `RelayStore.append` implementation
// production code uses, not a hand-rolled test double), which actually
// implements the (sessionId, dir, idempotencyKey) dedup that made the bare
// per-call counter dangerous in the first place.

async function* arrayEvents<T>(values: T[]): AsyncGenerator<T> {
	await Promise.resolve();
	for (const value of values) {
		yield value;
	}
}

const NEVER_FLUSH = () => new Promise<void>(() => undefined);

/** How many events survive across the two generations pushed below — named
 * so eslint's no-magic-numbers doesn't flag the bare literal. */
const TWO_GENERATIONS_OF_EVENTS = 2;

function pushToRelayStore(
	relayStore: ReturnType<typeof createInMemoryRelayStore>,
	sessionId: string
) {
	return async (batch: QueuedEvent<{ text: string }>[]): Promise<void> => {
		for (const item of batch) {
			await relayStore.append(
				sessionId,
				"events",
				item.event,
				item.idempotencyKey
			);
		}
	};
}

describe("forwardEvents idempotency keys across an in-place restart (real relay store)", () => {
	it("two forwardEvents generations under the same sessionId both deliver, even though each mints local counter 1", async () => {
		const relayStore = createInMemoryRelayStore();
		const sessionId = "sess_1";
		const push = pushToRelayStore(relayStore, sessionId);

		// Generation 0 — the CLI's initial launch under this bridge sessionId.
		await forwardEvents(arrayEvents([{ text: "gen0-a" }]), push, {
			maxBatchSize: 100,
			sleep: NEVER_FLUSH,
			generationId: 0,
		});

		// Generation 1 — restart-loop.ts relaunches the agent IN PLACE under the
		// SAME bridge sessionId (see restart-loop.ts's `generation` counter); a
		// fresh forwardEvents call resets its own local `nextEventId` back to 1.
		await forwardEvents(arrayEvents([{ text: "gen1-a" }]), push, {
			maxBatchSize: 100,
			sleep: NEVER_FLUSH,
			generationId: 1,
		});

		const observed = await relayStore.read(sessionId, "events", 0);
		// Pre-fix1, generation 1's local-counter-1 key ("1") collides with
		// generation 0's still-live key inside the relay's dedup window, so the
		// relay store silently treats it as a resend and drops it — this would
		// observe only 1 event instead of 2.
		expect(observed).toHaveLength(TWO_GENERATIONS_OF_EVENTS);
		expect(observed.map((event) => event.data)).toEqual([
			{ text: "gen0-a" },
			{ text: "gen1-a" },
		]);
	});

	it("within one generation, a resend of the same key is still deduped to a single event", async () => {
		const relayStore = createInMemoryRelayStore();
		const sessionId = "sess_2";

		// Simulates a push-queue retry: the SAME batch (same minted key) is
		// resent verbatim after its ack was lost — forwardEvents itself never
		// regenerates a key for an already-buffered event, see QueuedEvent's doc
		// comment.
		const first = await relayStore.append(
			sessionId,
			"events",
			{ text: "gen0-retry" },
			"0:1"
		);
		const resend = await relayStore.append(
			sessionId,
			"events",
			{ text: "gen0-retry" },
			"0:1"
		);

		expect(first).toEqual({ id: first.id, isNew: true });
		expect(resend).toEqual({ id: first.id, isNew: false });

		const observed = await relayStore.read(sessionId, "events", 0);
		expect(observed).toHaveLength(1);
		expect(observed[0]?.data).toEqual({ text: "gen0-retry" });
	});
});
