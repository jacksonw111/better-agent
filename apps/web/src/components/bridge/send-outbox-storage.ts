// fix-send-outbox: the send outbox's `sessionStorage` persistence, split out
// of send-outbox.ts for the repo's max-lines-per-file gate. Persistence is a
// BONUS, never a requirement: every path here degrades to "no persistence"
// rather than throwing, since a corrupt or disabled store must not be able to
// brick the terminal.

import type { OutboxEntry } from "./send-outbox-types";

/** `sessionStorage` key prefix — per SESSION, so two tabs on two different
 * bridge sessions never share (or clobber) each other's queue. */
export const OUTBOX_STORAGE_PREFIX = "ba:bridge:outbox:";

export function outboxStorageKey(sessionId: string): string {
	return `${OUTBOX_STORAGE_PREFIX}${sessionId}`;
}

/** The environment's `sessionStorage`, or `null` where there is none (SSR, the
 * node-environment unit tests) — persistence is a bonus, never a requirement. */
export function defaultOutboxStorage(): Storage | null {
	try {
		return typeof sessionStorage === "undefined" ? null : sessionStorage;
	} catch {
		// A privacy mode that throws on access — treat as "no persistence".
		return null;
	}
}

function isEntry(value: unknown): value is OutboxEntry {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.key === "string" && typeof candidate.attempts === "number"
	);
}

/**
 * Reads back a persisted queue. A `"sending"` entry is restored as `"queued"`:
 * whatever request was in flight when the page went away is gone with it, and
 * its idempotency key makes the resend safe even if it HAD reached the server.
 * Anything unparseable is dropped rather than thrown — a corrupt key must not
 * brick the terminal.
 */
export function loadOutbox(
	sessionId: string,
	storage: Storage | null
): OutboxEntry[] {
	const raw = storage?.getItem(outboxStorageKey(sessionId));
	if (!raw) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed
			.filter(isEntry)
			.map((entry) =>
				entry.status === "sending" ? { ...entry, status: "queued" } : entry
			);
	} catch {
		return [];
	}
}

export function saveOutbox(
	sessionId: string,
	entries: OutboxEntry[],
	storage: Storage | null
): void {
	if (!storage) {
		return;
	}
	try {
		if (entries.length === 0) {
			storage.removeItem(outboxStorageKey(sessionId));
			return;
		}
		storage.setItem(outboxStorageKey(sessionId), JSON.stringify(entries));
	} catch {
		// Quota exceeded / storage disabled — the in-memory queue still works,
		// only the survive-a-reload guarantee is lost.
	}
}
