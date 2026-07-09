// pi's getStatus tracker, split out of pi.ts purely to keep it under the
// repo's max-lines-per-file gate — mirrors codex-status.ts/opencode-status.ts
// living alongside pi.ts the same way their normalize/ counterparts do.

import {
	buildPiGetStateCommand,
	normalizePiStateModel,
} from "../normalize/pi-commands";
import {
	buildPiGetSessionStatsCommand,
	normalizePiSessionStats,
	normalizePiStateRunning,
	type PiSessionStats,
} from "../normalize/pi-status";
import type { NormalizedEvent } from "../normalize/types";
import { STATUS_SNAPSHOT_STATUS } from "./types";

/** How long `request()` waits for both replies before giving up and pushing
 * whatever's known so far — pi has no request ids and, unlike claude-code's
 * SDK control channel, no guaranteed reply at all, so an unanswered
 * `get_session_stats`/`get_state` must never leave `pending` (and the web's
 * Status popover) stuck forever. Mirrors claude-code-status.ts's
 * `CONTROL_CALL_TIMEOUT_MS`. */
const STATUS_TIMEOUT_MS = 4000;

/**
 * Tracks one in-flight `getStatus` request: `request()` fires the
 * `get_session_stats` + `get_state` frames, `onLine` collects both replies,
 * and ONE `status_snapshot` event is pushed the moment both have arrived (a
 * new `request()` before then simply re-arms with fresh frames) — or,
 * failing that, once `STATUS_TIMEOUT_MS` elapses, with whichever piece(s)
 * never arrived simply absent. pi has no request ids, so replies are matched
 * by command name — see the ASSUMPTION notes in normalize/pi-status.ts for
 * the response shapes.
 */
export function makePiStatusTracker(
	io: { writeLine(line: string): void },
	events: { push(event: NormalizedEvent): void }
): { onLine(raw: unknown): void; request(): void } {
	let pending = false;
	let stats: PiSessionStats | undefined;
	let state: { model?: string; running?: boolean } | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const resolve = (): void => {
		if (!pending) {
			return;
		}
		pending = false;
		clearTimeout(timer);
		events.push({
			kind: "status",
			status: STATUS_SNAPSHOT_STATUS,
			detail: { model: state?.model, running: state?.running, ...stats },
		});
	};

	return {
		request(): void {
			pending = true;
			stats = undefined;
			state = undefined;
			clearTimeout(timer);
			timer = setTimeout(resolve, STATUS_TIMEOUT_MS);
			io.writeLine(buildPiGetSessionStatsCommand());
			io.writeLine(buildPiGetStateCommand());
		},
		onLine(raw: unknown): void {
			if (!pending) {
				return;
			}
			stats = normalizePiSessionStats(raw) ?? stats;
			const running = normalizePiStateRunning(raw);
			if (running !== undefined) {
				state = { model: normalizePiStateModel(raw), running };
			}
			if (stats && state) {
				resolve();
			}
		},
	};
}
