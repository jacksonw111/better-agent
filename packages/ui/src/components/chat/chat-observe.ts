import type { MessageHistory } from "@jacksonw111/agent-client";
import type { MutableRefObject } from "react";

// ── observing mode ───────────────────────────────────────────────────────────
// Turns run detached on the server (parts persist progressively). After a
// reload there is no local stream, but the trailing assistant message is still
// `streaming` — so we OBSERVE it: poll history until it completes. A turn whose
// content stops changing for too long is treated as orphaned and left alone.
const OBSERVE_POLL_MS = 1500;
const STALL_MS = 120_000;

export type StallRef = MutableRefObject<{
	fingerprint: string;
	since: number;
} | null>;

export function liveTrailingTurn(rows: MessageHistory | undefined) {
	const last = rows?.at(-1);
	return last &&
		last.message.role === "assistant" &&
		last.message.status === "streaming"
		? last
		: null;
}

function turnFingerprint(row: MessageHistory[number]): string {
	return `${row.message.id}:${row.parts.length}:${JSON.stringify(row.parts).length}`;
}

export function observePollInterval(
	rows: MessageHistory | undefined,
	stallRef: StallRef
): number | false {
	const live = liveTrailingTurn(rows);
	if (!live) {
		stallRef.current = null;
		return false;
	}
	const fingerprint = turnFingerprint(live);
	const now = Date.now();
	if (stallRef.current?.fingerprint !== fingerprint) {
		stallRef.current = { fingerprint, since: now };
	}
	return now - stallRef.current.since > STALL_MS ? false : OBSERVE_POLL_MS;
}

export function isObserving(
	rows: MessageHistory | undefined,
	stallRef: StallRef
): boolean {
	if (!liveTrailingTurn(rows)) {
		return false;
	}
	const stall = stallRef.current;
	return !(stall && Date.now() - stall.since > STALL_MS);
}
