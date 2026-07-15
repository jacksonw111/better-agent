// pi's stdout/stderr drain loops, split out of pi.ts purely to keep that file
// under the repo's 300-line cap (P4-T1's session-index wiring needed the room
// back, the same way pi-session-ready.ts and pi-stdout's other siblings were
// split out before).

import { normalizePiModelProviders } from "../normalize/pi-commands";
import { isRecord, type NormalizedEvent } from "../normalize/types";
import type { ApprovalRegistry } from "./approvals";
import { wirePiExtensionUiRequest } from "./pi-approvals";
import { tryParseJson } from "./pi-session-ready";
import type { QuestionRegistry } from "./questions";

/** The shared plumbing `drainPiStdout` closes over — bundled into one object
 * so it stays under the repo's max-params gate. */
export interface PiStdoutDeps {
	approvals: ApprovalRegistry;
	events: { push(event: NormalizedEvent): void };
	io: { lines: AsyncIterable<string>; writeLine(line: string): void };
	modelProviders: Record<string, string>;
	// R1-T2: the stateful normalizer — tracks tool-call name/duration across
	// lines (tool_execution_update's running preview, durationMs) — one
	// instance per session, so state doesn't leak across sessions.
	normalize: (raw: unknown) => NormalizedEvent[];
	// R3-T1 Part B: a `select` extension_ui_request's QuestionCard reply path.
	questions: QuestionRegistry;
	// P4-T1: watches get_state replies for the live session's sessionFile so
	// `listSessions` can scan the right directory — see pi-sessions.ts.
	sessionIndex: { onLine(raw: unknown): void };
	sessionReady: { onLine(raw: unknown): void };
	statusTracker: { onLine(raw: unknown): void };
	// R2-T3 item 1 (CRITICAL): tracks whether pi is mid-turn so `send()` can
	// decide whether the prompt frame needs `streamingBehavior: "followUp"`.
	streaming: { onLine(raw: unknown): void };
}

/** Consumes pi's stdout: feeds every parsed line to the session-ready +
 * status + session-index trackers, accumulates the modelId → provider map
 * `setModel` needs, routes `extension_ui_request` lines through the RC-T4
 * no-hang contract (see pi-approvals.ts), and forwards each normalized event.
 * Detached (fire-and-forget) from `start` purely to keep it under the line
 * gate. */
export async function drainPiStdout(deps: PiStdoutDeps): Promise<void> {
	const {
		approvals,
		events,
		io,
		modelProviders,
		normalize,
		questions,
		sessionIndex,
		sessionReady,
		statusTracker,
		streaming,
	} = deps;
	for await (const line of io.lines) {
		const raw = tryParseJson(line);
		sessionReady.onLine(raw);
		statusTracker.onLine(raw);
		streaming.onLine(raw);
		sessionIndex.onLine(raw);
		if (isRecord(raw)) {
			wirePiExtensionUiRequest(raw, { approvals, events, io, questions });
		}
		const nextProviders = normalizePiModelProviders(raw);
		if (nextProviders) {
			Object.assign(modelProviders, nextProviders);
		}
		for (const event of normalize(raw)) {
			events.push(event);
		}
	}
}

/** Forwards pi's stderr lines as error events. Detached from `start` for the
 * same reason as `drainPiStdout`. */
export async function drainPiStderr(
	io: { stderrLines: AsyncIterable<string> },
	events: { push(event: NormalizedEvent): void }
): Promise<void> {
	for await (const line of io.stderrLines) {
		events.push({ kind: "error", message: line });
	}
}
