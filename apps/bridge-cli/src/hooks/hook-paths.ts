import { homedir } from "node:os";
import { join } from "node:path";

// Observability slice B: the fixed local unix-domain-socket path both sides of
// the hook channel agree on. The CLI daemon (pty transport) listens here; each
// short-lived `agent-cli hook-emit <Event>` subprocess claude spawns connects
// here to hand off one event line. Under `~/.better-agent` (the same dir
// profile-sync already owns), kept short so it stays within the macOS
// 104-byte sun_path limit.

/** `~/.better-agent/hook.sock` — the daemon's hook-event listener socket. */
export function hookSocketPath(): string {
	return join(homedir(), ".better-agent", "hook.sock");
}
