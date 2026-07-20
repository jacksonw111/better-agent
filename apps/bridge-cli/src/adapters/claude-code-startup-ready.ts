// fix(resume-caps): claude's `system/init` line — previously the adapter's
// ONLY `session_ready` source — does not arrive in streaming-input mode until
// the FIRST user turn. A resumed session (and an empty-description chat),
// neither of which auto-sends anything at launch, therefore left the web
// handshake-less indefinitely: `resolveCapabilities` fell back to its static
// matrix, gating Git/Files/Shell behind "CLI 版本过旧" and hiding the
// composer's model/permission pickers on a fully current CLI. Verified
// against the real stack (2026-07-19): the resumed session's bridge_messages
// held no session_ready until a turn was sent. So `start()` emits this
// startup handshake — capabilities are a static constant, the model list
// comes off the SDK control channel (which resolves BEFORE init; measured
// ~3.9s on a real machine), model/permissionMode come from the persisted
// startup config. It carries NO `sessionId` (claude's conversation id only
// exists once init runs) so `captureAgentSessionId`/the server's
// `maybePersistAgentSessionId` ignore it; when the real init line arrives
// with the first turn, its full session_ready supersedes this one (the web's
// session-ready-fold replaces the base wholesale).

import type { NormalizedEvent } from "../normalize/types";
import {
	type ReportedModel,
	withReportedModels,
	withSessionCapabilities,
} from "./claude-code-models";
import { startupPermissionMode } from "./claude-code-startup-config";
import {
	type LastKnownSessionInfo,
	recordSessionInfo,
} from "./claude-code-status";
import type { StartOptions } from "./types";

interface StartupReadyDeps {
	dir: string;
	events: { push(event: NormalizedEvent): void };
	lastKnown: LastKnownSessionInfo;
	models: Promise<ReportedModel[] | undefined>;
	opts: StartOptions | undefined;
}

/**
 * Builds and pushes the startup `session_ready`, seeding the getStatus
 * snapshot (`lastKnown`) from it like `drainSession` does for the init line's.
 * Awaited by `start()` BEFORE `drainSession` begins (so no real
 * `session_ready` can ever precede it and then be shadowed by this sparser
 * one) and before the handle exists (so no user turn — the only init trigger
 * — can be in flight yet). Bounded by `fetchSupportedModels`'s own timeout;
 * a failed/timed-out model fetch still emits the handshake, just without a
 * `models` list.
 */
export async function pushStartupSessionReady(
	deps: StartupReadyDeps
): Promise<void> {
	const { dir, events, lastKnown, models, opts } = deps;
	const base: NormalizedEvent = {
		kind: "status",
		status: "session_ready",
		detail: {
			cwd: dir,
			// The canonical config model is alias-resolved by withReportedModels
			// (same as the init line's) so the composer menu can highlight it.
			model: opts?.config?.model,
			// No fallback: the SDK has no read for either value, so the ONLY
			// thing this handshake can honestly report is what the CLI itself
			// passed to `query()`. An unconfigured launch inherits whatever the
			// user's own settings say (`permissions.defaultMode` need not be
			// "default"), which this process cannot see — reporting a guessed
			// "default" made the composer show a mode the session might not be
			// in. Omitting the field leaves the menu unselected (the web shows a
			// neutral placeholder) until the real init line supplies the truth.
			permissionMode: startupPermissionMode(opts?.config),
		},
	};
	const event = withSessionCapabilities(await withReportedModels(base, models));
	recordSessionInfo(event, lastKnown);
	events.push(event);
}
