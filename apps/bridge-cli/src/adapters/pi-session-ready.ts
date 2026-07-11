// `makePiSessionReadyTracker` + its `tryParseJson` helper — split out of
// pi.ts purely to keep that file under the repo's 300-line cap (R3-T1 Part B
// needed the room back for the `questions`/`answerQuestion` wiring).

import {
	normalizePiAvailableModels,
	normalizePiCommandCatalog,
	normalizePiCommandsResponse,
	normalizePiStateModel,
} from "../normalize/pi-commands";
import type { NormalizedEvent } from "../normalize/types";
import { PI_SESSION_CAPABILITIES } from "./session-capabilities";

export function tryParseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/**
 * Tracks the three pieces `session_ready` is assembled from — `get_state`'s
 * model, `get_available_models`' list, and `get_commands`' slash commands/skills
 * — and pushes exactly one `session_ready` event, the moment the commands list
 * is known (using whatever model/models have arrived by then, if any).
 */
export function makePiSessionReadyTracker(events: {
	push(event: NormalizedEvent): void;
}): {
	onLine(raw: unknown): void;
} {
	let emitted = false;
	let model: string | undefined;
	let models: string[] | undefined;
	return {
		onLine(raw: unknown): void {
			const nextModel = normalizePiStateModel(raw);
			if (nextModel !== undefined) {
				model = nextModel;
			}
			const nextModels = normalizePiAvailableModels(raw);
			if (nextModels !== undefined) {
				models = nextModels;
			}
			if (emitted) {
				return;
			}
			const commands = normalizePiCommandsResponse(raw);
			if (!commands) {
				return;
			}
			emitted = true;
			events.push({
				kind: "status",
				status: "session_ready",
				detail: {
					model,
					models,
					...commands,
					capabilities: PI_SESSION_CAPABILITIES,
				},
			});
			// R5-T1: the richer per-entry catalog (name/description/source) — same
			// `get_commands` response, parsed a second way; pushed right after
			// session_ready rather than merged into it (mirrors codex/opencode-serve).
			const catalog = normalizePiCommandCatalog(raw);
			if (catalog) {
				events.push({
					kind: "status",
					status: "command_catalog",
					detail: catalog,
				});
			}
		},
	};
}
