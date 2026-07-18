// A1 (event-loss audit): the per-session out-of-band wiring restart-loop.ts
// hangs off its reliable sender — split out of that file purely to keep it
// under the repo's max-lines-per-file gate.

import { agentSupportsImages } from "./adapters/session-capabilities";
import type { BridgeCliArgs } from "./args";
import type { ImageInputDeps } from "./image-input";
import { createOobSender, type OobSender } from "./oob-push";
import type { RelayTransport } from "./relay-client";
import type { ShellRunnerDeps } from "./shell-runner";

/** A1: the caller's sender when supplied (task-launch's run-session.ts passes
 * the one it already used at launch), otherwise a fresh one over this
 * session's transport — see `RunRestartLoopOptions.oobSender`. */
export function resolveOobSender(options: {
	oobSender?: OobSender;
	sessionId: string;
	transport: RelayTransport;
}): OobSender {
	return (
		options.oobSender ??
		createOobSender({
			pushEvents: (input) => options.transport.pushEvents(input),
			sessionId: options.sessionId,
		})
	);
}

/** P3-T2: builds the image layer's deps for this session — download via the
 * transport's bridge-token-authed `getAttachment`, capability from the
 * adapter's own constant, failure notes pushed through the session's
 * reliable out-of-band channel (A1, replacing the old swallowed attempt). */
export function buildImageInputDeps(
	args: BridgeCliArgs,
	transport: RelayTransport,
	oob: OobSender
): ImageInputDeps {
	const { getAttachment } = transport;
	return {
		fetchImage: getAttachment
			? (attachmentId) => getAttachment({ attachmentId })
			: undefined,
		pushStatus: (event) => oob.push("image", event),
		supportsImages: agentSupportsImages(args.agentKind),
	};
}

/** P4-T2: the shell runner's deps for this session — commands run in the
 * CLI's validated workspace dir; events ride the A1 out-of-band channel. */
export function buildShellRunnerDeps(
	args: BridgeCliArgs,
	oob: OobSender
): ShellRunnerDeps {
	return { dir: args.dir, pushEvent: (event) => oob.push("shell", event) };
}
