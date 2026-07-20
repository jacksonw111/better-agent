// R5-T1: claude-code's slash-command catalog — split out of claude-code.ts
// purely to keep that file under the repo's 300-line limit; mirrors
// claude-code-models.ts's fetch-with-timeout shape (`fetchSupportedModels`).
// The mid-session dynamic push (`commands_changed`) is handled separately in
// normalize/claude-code.ts, since it arrives as a plain SDK message through
// the same stream `drainSession` already normalizes — no adapter-side fetch
// needed for that half.

import type { query, SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { NormalizedEvent } from "../normalize/types";

export type ClaudeQuery = ReturnType<typeof query>;

/** Mirrors claude-code-models.ts's SUPPORTED_MODELS_TIMEOUT_MS (raised to 8s
 * alongside it — the control channel measured ~3.9s on a real plugin-heavy
 * machine): a safety valve so a stuck control channel can never hang the
 * catalog fetch forever. Fire-and-forget, so unlike the models fetch this
 * never delays `start()`. */
const SUPPORTED_COMMANDS_TIMEOUT_MS = 8000;

/** Fetches this session's slash-command catalog off the SDK control channel,
 * resolving to `undefined` (never rejecting, never hanging) on any failure or
 * timeout. */
export function fetchSupportedCommands(
	session: ClaudeQuery
): Promise<SlashCommand[] | undefined> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => resolve(undefined), SUPPORTED_COMMANDS_TIMEOUT_MS);
	});
	const commands = session
		.supportedCommands()
		.catch(() => undefined)
		.finally(() => clearTimeout(timer));
	return Promise.race([commands, timeout]);
}

/** Builds the `command_catalog` status event both the one-time initial fetch
 * (this file) and the mid-session `commands_changed` push
 * (normalize/claude-code.ts) emit — the web's `bridge-command-catalog.ts`
 * parses either the same way, replacing its cached list each time (the SDK
 * doc comment on `SDKCommandsChangedMessage`: "Clients should REPLACE their
 * cached command list with this payload"). */
export function commandCatalogEvent(commands: SlashCommand[]): NormalizedEvent {
	return {
		kind: "status",
		status: "command_catalog",
		detail: {
			commands: commands.map((command) => ({
				name: command.name,
				description: command.description,
			})),
		},
	};
}
