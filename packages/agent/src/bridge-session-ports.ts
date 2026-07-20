// Bridge-session + bridge-message store ports, split out of ports.ts to keep
// that file under the repo's 300-line cap (same precedent as memory-ports.ts /
// skill-ports.ts / bridge-token-ports.ts) and re-exported from there, so the
// public `@better-agent/agent/ports` surface is unchanged.

import type { BridgeAgentKind } from "./bridge-token-ports";

export type BridgeSessionStatus = "active" | "ended";

export interface BridgeSessionRow {
	agentKind: BridgeAgentKind;
	agentSessionId: string | null;
	/** P3-T1: set when the user archives the session from the web, null once
	 * restored. Archived rows are excluded from the default list page. */
	archivedAt: Date | null;
	createdAt: Date;
	id: string;
	label: string | null;
	/** The last model this session was observed running with (`session_ready`
	 * / `model_changed`). Optional (not `string | null`) so pre-existing row
	 * literals in tests keep compiling — same precedent as `runId`. */
	lastModel?: string | null;
	/** `lastModel`'s twin for the permission mode
	 * (`session_ready` / `permission_mode_changed`). */
	lastPermissionMode?: string | null;
	lastSeenAt: Date;
	/** P3-T1: user-set display name (web rename) — distinct from `label`, the
	 * CLI's launch-time label, which is never mutated. */
	name: string | null;
	/** S2-T2 (D4): the Run this session relays for, set at creation when the
	 * client starts the session with its Run-bound credential. Optional (not
	 * `string | null`) so pre-existing row literals in tests keep compiling —
	 * same precedent as Context's authedBridgeToken/computerAuth. */
	runId?: string | null;
	starred: boolean;
	status: BridgeSessionStatus;
	tokenId: string;
	userId: string;
	vncEndpoint: string | null;
}

/** Keyset cursor for `BridgeSessionStore.listPageByUser`: the page continues
 * strictly AFTER this (createdAt, id) position in the newest-first order —
 * i.e. rows with a smaller (createdAt, id). `id` breaks createdAt ties so the
 * cursor is stable even when two sessions share a timestamp. */
export interface BridgeSessionCursor {
	createdAt: Date;
	id: string;
}

export interface BridgeSessionStore {
	create(input: {
		userId: string;
		tokenId: string;
		agentKind: BridgeAgentKind;
		label?: string;
		/** S2-T2 (D4): binds the session to its Run at creation. */
		runId?: string;
	}): Promise<BridgeSessionRow>;
	/** Hard-deletes the session row (and its persisted messages) if it belongs
	 * to `userId`; a no-op otherwise. */
	deleteHard(id: string, userId: string): Promise<void>;
	end(id: string, userId: string): Promise<void>;
	get(id: string): Promise<BridgeSessionRow | null>;
	listByUser(userId: string): Promise<BridgeSessionRow[]>;
	/** One page of the user's sessions, newest first (createdAt DESC, id DESC
	 * tie-break). `before` resumes strictly after that cursor position; omit it
	 * for the first page. `tokenId` narrows the page to one bridge token's
	 * sessions. `archived: true` returns ONLY archived rows; otherwise archived
	 * rows are excluded. Returns at most `limit` rows. */
	listPageByUser(
		userId: string,
		opts: {
			limit: number;
			archived?: boolean;
			before?: BridgeSessionCursor;
			tokenId?: string;
		}
	): Promise<BridgeSessionRow[]>;
	/** Sets (or clears, with null) the user-set display name, owner-guarded. */
	rename(id: string, userId: string, name: string | null): Promise<void>;
	setAgentSessionId(id: string, agentSessionId: string): Promise<void>;
	/** Sets or clears `archivedAt`, owner-guarded. */
	setArchived(id: string, userId: string, archived: boolean): Promise<void>;
	/** Records the session's latest reported model / permission mode. Only the
	 * PROVIDED fields are written (an omitted/undefined one leaves the stored
	 * value alone), so a read-back carrying just one field can't blank the
	 * other; last writer wins per field. A call with neither field is a no-op. */
	setLastSessionInfo(
		id: string,
		info: { model?: string; permissionMode?: string }
	): Promise<void>;
	setStarred(id: string, userId: string, starred: boolean): Promise<void>;
	setVncEndpoint(id: string, vncEndpoint: string | null): Promise<void>;
	touch(id: string): Promise<void>;
}

/** A persisted bridge event, keyed by the relay's own SERVER-assigned seq. */
export interface BridgeMessageRow {
	event: unknown;
	seq: number;
}

export interface BridgeMessageStore {
	/** Persists one relayed event under its relay-assigned seq. */
	append(sessionId: string, seq: number, event: unknown): Promise<void>;
	/** Persists a batch of relayed events under their own seq, in one round trip. */
	appendMany(sessionId: string, rows: BridgeMessageRow[]): Promise<void>;
	/** Returns persisted events with seq > afterSeq, in ascending seq order. */
	list(
		sessionId: string,
		afterSeq: number,
		limit: number
	): Promise<BridgeMessageRow[]>;
	/** Returns the LAST `limit` persisted events (highest seqs), in ascending
	 * seq order — the bounded backward scan `bridge.pendingRequests` (P5-1)
	 * uses to find still-open approval/question events near the stream's tail
	 * without paging the whole history forward. */
	listTail(sessionId: string, limit: number): Promise<BridgeMessageRow[]>;
}
