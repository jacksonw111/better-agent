// RC-T3 (docs/remote-control-redesign-plan.md, Pillar 3): straggler detection
// for `relay-client.ts`'s `forwardEvents` — split out purely to keep that
// file under the repo's 300-line limit.

/** Reads the numeric `turnEpoch` an adapter stamped onto an event (see
 * `adapters/turn-epoch.ts`) — `undefined` for anything unstamped (a
 * non-NormalizedEvent test double, or an adapter not yet wired for epoch
 * stamping), which `forwardEvents` never drops. */
function turnEpochOf(event: unknown): number | undefined {
	const value =
		typeof event === "object" && event !== null
			? (event as Record<string, unknown>).turnEpoch
			: undefined;
	return typeof value === "number" ? value : undefined;
}

/** Tracks the highest `turnEpoch` forwarded so far (`highest.epoch`, mutated
 * in place) and reports whether `event` is a straggler from a superseded
 * turn — e.g. opencode-serve's SSE stream still delivering an aborted turn's
 * events after `interrupt()` already bumped the epoch, or any adapter's
 * in-flight output racing a fresh `send()`. An event carrying no stamped
 * epoch (a non-NormalizedEvent test double, or an adapter not yet wired for
 * epoch stamping) is never treated as stale. */
export function isStaleTurnEvent(
	event: unknown,
	highest: { epoch: number }
): boolean {
	const epoch = turnEpochOf(event);
	if (epoch === undefined) {
		return false;
	}
	if (epoch < highest.epoch) {
		return true;
	}
	highest.epoch = epoch;
	return false;
}
