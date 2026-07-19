import {
	asOptionalString,
	isRecord,
	MODEL_CHANGED_STATUS,
	PERMISSION_MODE_CHANGED_STATUS,
	parseSessionReadyDetail,
	SESSION_READY_STATUS,
	type SessionReadyDetail,
} from "./bridge-session-status";

// fix-caps-regression: the feed's sessionReady fold, id-tracked. The previous
// fold (2068433's `foldSessionReadyDetail`) patched a read-back by spreading
// onto the running detail — which, when a `permission_mode_changed`/
// `model_changed` folded BEFORE the `session_ready` handshake (the SDK pushes
// a status permissionMode line early on resume, and a late history/poll
// backfill can reorder batches the same way), FABRICATED a partial detail
// holding only that one field. Every capability consumer then read a
// sessionReady with no `capabilities`: `resolveCapabilities` fell back to the
// static matrix (Git/Files/Shell tabs gated behind "CLI 版本过旧" on a current
// CLI), the composer lost its `models` list, and downstream renders churned on
// the malformed detail. This fold keeps the HANDSHAKE as the only source of a
// detail (no handshake → null, never a fragment) and stashes read-backs as
// per-field patches with their event id, so ordering can't corrupt anything.

/** One read-back's value plus the feed event id that carried it — the id is
 * what lets a patch outrank (or lose to) a `session_ready` regardless of the
 * order the two FOLDED in. */
interface FieldPatch {
	eventId: number;
	value: string;
}

export interface SessionReadyFold {
	/** The latest parsed `session_ready` detail — the only thing that can make
	 * `sessionReadyOf` non-null. */
	base: SessionReadyDetail | null;
	/** Read-back patches by field, newest event id wins per field. Kept OUT of
	 * `base` so a read-back can never touch (or fabricate) any other field. */
	patches: { model?: FieldPatch; permissionMode?: FieldPatch };
	/** The feed event id `base` came from (0 before any handshake) — a patch
	 * only applies when its own id is newer than this. */
	readyEventId: number;
}

export const initialSessionReadyFold: SessionReadyFold = {
	base: null,
	patches: {},
	readyEventId: 0,
};

type PatchField = "model" | "permissionMode";

/** Extracts the read-back's string value off its wire detail — undefined for
 * a malformed detail, which the caller treats as "ignore the event". */
function patchOf(
	detail: unknown,
	field: PatchField,
	eventId: number
): FieldPatch | undefined {
	const value = isRecord(detail) ? asOptionalString(detail[field]) : undefined;
	return value === undefined ? undefined : { eventId, value };
}

/** Records one field's read-back, newest event id wins: a stale duplicate or
 * an out-of-order redelivery older than what's already recorded leaves the
 * state untouched (same reference). */
function withPatch(
	prev: SessionReadyFold,
	field: PatchField,
	patch: FieldPatch | undefined
): SessionReadyFold {
	if (!patch) {
		return prev;
	}
	const existing = prev.patches[field];
	if (existing && existing.eventId >= patch.eventId) {
		return prev;
	}
	return { ...prev, patches: { ...prev.patches, [field]: patch } };
}

/**
 * Folds one status event into the running fold state: a `session_ready`
 * replaces the base wholesale (existing patches keep their ids, so ones older
 * than the new handshake simply stop applying), a read-back records a
 * per-field patch — stashed even when no handshake has arrived yet, WITHOUT
 * fabricating a detail — and `undefined` means "not a sessionReady-affecting
 * status" (the caller leaves its state untouched).
 */
export function foldSessionReadyEvent(
	prev: SessionReadyFold,
	id: number,
	event: { detail?: unknown; status: string }
): SessionReadyFold | undefined {
	if (event.status === SESSION_READY_STATUS) {
		return {
			...prev,
			base: parseSessionReadyDetail(event.detail),
			readyEventId: id,
		};
	}
	if (event.status === PERMISSION_MODE_CHANGED_STATUS) {
		return withPatch(
			prev,
			"permissionMode",
			patchOf(event.detail, "permissionMode", id)
		);
	}
	if (event.status === MODEL_CHANGED_STATUS) {
		return withPatch(prev, "model", patchOf(event.detail, "model", id));
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** The derived `sessionReady` detail: null until a handshake has arrived
 * (NEVER a fabricated fragment), otherwise the handshake with any NEWER
 * read-back values overlaid — capability fields always come from the
 * handshake alone. */
export function sessionReadyOf(
	fold: SessionReadyFold
): SessionReadyDetail | null {
	const { base, patches, readyEventId } = fold;
	if (!base) {
		return null;
	}
	const detail = { ...base };
	if (patches.model && patches.model.eventId > readyEventId) {
		detail.model = patches.model.value;
	}
	if (patches.permissionMode && patches.permissionMode.eventId > readyEventId) {
		detail.permissionMode = patches.permissionMode.value;
	}
	return detail;
}
