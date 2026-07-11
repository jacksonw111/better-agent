// pi's `setModel`/`setThinking` (R2-T3 item 2) controls, split out of pi.ts
// purely to keep that file under the repo's 300-line limit.

import {
	buildPiSetModelCommand,
	buildPiSetThinkingLevelCommand,
	isPiThinkingLevel,
} from "../normalize/pi-commands";
import type { NormalizedEvent } from "../normalize/types";

/** Resolves the `{provider, modelId}` pi's `set_model` needs from the bare id
 * the web menu sends: a `provider/id` string splits directly; otherwise the
 * provider is looked up in the model→provider map built from
 * `get_available_models`. `null` when the provider can't be resolved. */
function resolvePiSetModel(
	model: string,
	providers: Record<string, string>
): { modelId: string; provider: string } | null {
	const slash = model.indexOf("/");
	if (slash > 0) {
		return { provider: model.slice(0, slash), modelId: model.slice(slash + 1) };
	}
	const provider = providers[model];
	return provider ? { provider, modelId: model } : null;
}

/** The `setModel` control: resolves the provider for the chosen id, then writes
 * pi's `{provider, modelId}` set_model frame — or an error event if the
 * provider is unknown. */
export function makePiSetModel(
	io: { writeLine(line: string): void },
	events: { push(event: NormalizedEvent): void },
	modelProviders: Record<string, string>
): (model: string) => void {
	return (model: string) => {
		const resolved = resolvePiSetModel(model, modelProviders);
		if (resolved) {
			io.writeLine(buildPiSetModelCommand(resolved.provider, resolved.modelId));
		} else {
			events.push({
				kind: "error",
				message: `pi setModel: unknown provider for model "${model}"`,
			});
		}
	};
}

/** The `setThinking` control (R2-T3 item 2): validates the level against pi's
 * fixed vocabulary (`isPiThinkingLevel`) before writing `set_thinking_level`
 * — an unrecognized level degrades to a visible error event instead of a
 * frame pi itself would reject. */
export function makePiSetThinking(
	io: { writeLine(line: string): void },
	events: { push(event: NormalizedEvent): void }
): (level: string) => void {
	return (level: string) => {
		if (isPiThinkingLevel(level)) {
			io.writeLine(buildPiSetThinkingLevelCommand(level));
		} else {
			events.push({
				kind: "error",
				message: `pi setThinking: unknown thinking level "${level}"`,
			});
		}
	};
}
