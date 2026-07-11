// R0-T2 (local-agent transport refactor): the WS-duplex counterpart to
// poll-loop.ts — split out of run-bridge-session.ts purely to keep that file
// (and this one) under the repo's max-lines-per-file gate. Owns two things
// for the lifetime of one live `DuplexChannel`:
//
//   1. `push` — a "hybrid" forwardEvents sink that sends over the channel
//      until (if) it goes down, then transparently falls through to the
//      existing HTTP `pushEvents` for the rest of the generation.
//   2. `outcome` — a `PollOutcome` promise driven by `channel.onCommand`
//      (via `resolveControlOutcome`, shared verbatim with poll-loop.ts so a
//      stop/restart command produces IDENTICAL results over either
//      transport), that falls back to running the real `pollLoop` — reusing
//      the SAME `afterIdRef` the channel already advanced — the moment
//      `channel.onDown` fires.
//
// Both share one `down` flag (`DuplexPhaseState`) so a mid-flight `sendEvents`
// failure and an explicit `onDown` agree about which path is live, without
// either module reaching into the other's internals.

import { resolveControlOutcome } from "./command-outcome";
import type { AfterIdRef, CommandSink } from "./commands";
import type { QueuedEvent } from "./forward-events";
import { type PollLoopOptions, type PollOutcome, pollLoop } from "./poll-loop";
import type { RelayTransport } from "./relay-client";
import type { DuplexChannel } from "./ws-duplex";

export interface RunDuplexPhaseArgs {
	afterIdRef: AfterIdRef;
	channel: DuplexChannel;
	pollController: AbortController;
	pollOptions?: Omit<PollLoopOptions, "signal">;
	sessionId: string;
	sink: CommandSink;
	transport: RelayTransport;
}

export interface DuplexPhase {
	/** Resolves once the channel (or its poll-mode fallback) reports a
	 * terminal `stop`/`restart`, or `pollController.signal` aborts (the
	 * SAME "the other loop already ended" signal `pollLoop` reacts to). */
	outcome: Promise<PollOutcome>;
	/** Drop-in `forwardEvents` push: routes over `channel.sendEvents` while
	 * the channel is live, HTTP `pushEvents` once it isn't. */
	push(batch: QueuedEvent<unknown>[]): Promise<void>;
}

interface DuplexPhaseState {
	down: boolean;
}

function pushViaHttp(
	transport: RelayTransport,
	sessionId: string,
	batch: QueuedEvent<unknown>[]
): Promise<void> {
	return transport.pushEvents({
		sessionId,
		events: batch.map((item) => item.event),
		idempotencyKeys: batch.map((item) => item.idempotencyKey),
	});
}

/** While the channel is up, sends straight over it; the INSTANT it rejects
 * (the channel just went down mid-send — see `ws-duplex.ts`'s `downFired`
 * check) latches `state.down` and retries that same batch over HTTP instead
 * of losing it or propagating the rejection into `forwardEvents`'s own retry
 * queue (which has no idea the transport underneath it just changed). */
function buildHybridPush(
	state: DuplexPhaseState,
	args: RunDuplexPhaseArgs
): (batch: QueuedEvent<unknown>[]) => Promise<void> {
	return async (batch) => {
		if (state.down) {
			await pushViaHttp(args.transport, args.sessionId, batch);
			return;
		}
		try {
			await args.channel.sendEvents(batch);
		} catch {
			state.down = true;
			await pushViaHttp(args.transport, args.sessionId, batch);
		}
	};
}

/** One command frame off the channel: dispatches it through the SAME
 * `resolveControlOutcome` poll-loop.ts uses, so a `stop`/`restart` control
 * command produces an identical `PollOutcome`-worthy result regardless of
 * which transport delivered it.
 *
 * Returns the dispatch promise (instead of swallowing it) so
 * `ws-duplex-frames.ts`'s `handleCommandFrame` — which awaits whatever
 * `onCommand`'s handler returns — knows whether dispatch succeeded, and only
 * advances its own (channel-internal) `lastCommandId` past this command if it
 * did. That's the ONLY thing a rejection here does on its own: any actual
 * throw from `dispatchCommands` (e.g. `sink.send`/`answerApproval` throwing —
 * NOT `resolveControlOutcome`'s own best-effort status push, which already
 * swallows its own failure internally, see command-outcome.ts) is surfaced
 * via `pollOptions.onError`, the exact same hook `pollLoop` reports an
 * identical `sink.send` throw through (see poll-loop.ts's `pollStep`) —
 * instead of a blanket `.catch(() => undefined)` silently dropping it. Since
 * `dispatchCommands` never reached its `afterIdRef.current = command.id` line
 * for a command that threw (see commands.ts), `afterIdRef` is left
 * un-advanced too, same as `lastCommandId` above — both trackers move
 * together, only on success. A command that throws gets redelivered next
 * time (reconnect resumes from `lastCommandId`, the polling fallback from
 * `afterIdRef`) — idempotent-enough since `send`/`answerApproval` are. */
function handleDuplexCommand(
	args: RunDuplexPhaseArgs,
	cmd: { data: unknown; id: number },
	finish: (outcome: PollOutcome) => void
): Promise<void> {
	return resolveControlOutcome({
		afterIdRef: args.afterIdRef,
		commands: [cmd],
		sessionId: args.sessionId,
		sink: args.sink,
		transport: args.transport,
	})
		.then((result) => {
			if (result.control === "stop") {
				finish("stopped");
			} else if (result.control === "restart") {
				finish("restart");
			}
		})
		.catch((error: unknown) => {
			args.pollOptions?.onError?.(error);
			throw error;
		});
}

/** `channel.onDown` fired: the channel is irrecoverably gone for the rest of
 * this generation. Latches `state.down` (so `push` stops trying it) and hands
 * command delivery off to the existing `pollLoop`, resuming from the SAME
 * `afterIdRef` the channel already advanced past every command it delivered
 * — the server never re-sends one already acknowledged over WS. */
function fallbackToPolling(
	state: DuplexPhaseState,
	args: RunDuplexPhaseArgs,
	reason: string,
	finish: (outcome: PollOutcome) => void
): void {
	state.down = true;
	process.stderr.write(
		`bridge: ws duplex channel down (${reason}) — falling back to polling\n`
	);
	pollLoop(args.transport, args.sessionId, args.sink, args.afterIdRef, {
		...args.pollOptions,
		signal: args.pollController.signal,
	})
		.then(finish)
		.catch(() => finish("ended"));
}

function buildDuplexOutcome(
	state: DuplexPhaseState,
	args: RunDuplexPhaseArgs
): Promise<PollOutcome> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: PollOutcome) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(result);
		};
		args.pollController.signal.addEventListener("abort", () => finish("ended"));
		if (args.pollController.signal.aborted) {
			finish("ended");
			return;
		}
		args.channel.onCommand((cmd) => handleDuplexCommand(args, cmd, finish));
		args.channel.onDown((reason) =>
			fallbackToPolling(state, args, reason, finish)
		);
	});
}

/** Builds the WS-duplex counterpart to poll-loop.ts's `pollLoop` +
 * `pushEvents` pair: a `push` for `forwardEvents` and an `outcome` promise,
 * both wired to the same live `channel` and sharing one `down` latch — see
 * this module's own top comment. */
export function runDuplexPhase(args: RunDuplexPhaseArgs): DuplexPhase {
	const state: DuplexPhaseState = { down: false };
	return {
		outcome: buildDuplexOutcome(state, args),
		push: buildHybridPush(state, args),
	};
}
