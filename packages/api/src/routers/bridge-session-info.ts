import { log } from "evlog";
import type { Context } from "../context";

// Persists the session's last-known model / permission mode as its events flow
// through ingest — the mirror of `bridge-agent-session-id.ts`, riding the SAME
// write path rather than adding a round trip. The SDK exposes `setModel` /
// `setPermissionMode` but NO way to read either back, so the only truth about
// what a session is running is what the CLI reports on the wire: the
// `session_ready` handshake and the `model_changed` /
// `permission_mode_changed` read-backs. Without persisting them, a resumed run
// has nothing to start from and the composer's menus show no selected value
// until the user sends a turn (which is what triggers claude's init line in
// streaming-input mode). `tasks.resume` reads these back — see
// tasks-resume.ts.

/** Statuses whose detail carries a live model/permissionMode worth recording —
 * mirrors the CLI's own `SESSION_INFO_STATUSES`
 * (apps/bridge-cli/src/adapters/claude-code-status.ts). */
const SESSION_INFO_STATUSES = new Set([
	"session_ready",
	"model_changed",
	"permission_mode_changed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The `{model, permissionMode}` an event reports, or null when it isn't a
 * session-info status / carries neither field. Each field is independently
 * optional: a read-back names exactly one, and an absent one must NOT be
 * written (see the store's `setLastSessionInfo`) or it would blank the other. */
export function extractSessionInfo(
	event: unknown
): { model?: string; permissionMode?: string } | null {
	if (
		!isRecord(event) ||
		event.kind !== "status" ||
		typeof event.status !== "string" ||
		!SESSION_INFO_STATUSES.has(event.status) ||
		!isRecord(event.detail)
	) {
		return null;
	}
	const model = asOptionalString(event.detail.model);
	const permissionMode = asOptionalString(event.detail.permissionMode);
	if (model === undefined && permissionMode === undefined) {
		return null;
	}
	return { model, permissionMode };
}

/** Best-effort: records the reported model/permission mode onto the bridge
 * session row. Never throws — a failure here must not break the live relay,
 * same rationale as `maybePersistAgentSessionId`. */
export async function maybePersistSessionInfo(
	context: Context,
	sessionId: string,
	event: unknown
): Promise<void> {
	const info = extractSessionInfo(event);
	if (info === null) {
		return;
	}
	try {
		await context.services.stores.bridgeSession.setLastSessionInfo(
			sessionId,
			info
		);
	} catch (err) {
		log.error({
			action: "bridge pushEvents setLastSessionInfo",
			error: String(err),
		});
	}
}
