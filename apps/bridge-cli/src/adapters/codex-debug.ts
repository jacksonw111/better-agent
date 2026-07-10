// Ground-truth capture for the codex wire. codex's `item/*` notification
// shapes drift across builds, and this sandbox has no codex binary to verify
// them against — so when `BRIDGE_DEBUG_CODEX` is set, every raw notification is
// dumped to stderr as `[codex-raw] <method> <params-json>`. Lets a user on a
// real binary capture their actual event stream (method names, item `type`
// strings, and which field holds the message text) so we can confirm the
// normalize mapping against their codex version. Off by default — zero cost.
const CODEX_RAW_DEBUG = Boolean(process.env.BRIDGE_DEBUG_CODEX);

export function logRawCodexNotification(method: string, params: unknown): void {
	if (!CODEX_RAW_DEBUG) {
		return;
	}
	let payload: string;
	try {
		payload = JSON.stringify(params);
	} catch {
		payload = String(params);
	}
	process.stderr.write(`[codex-raw] ${method} ${payload}\n`);
}
