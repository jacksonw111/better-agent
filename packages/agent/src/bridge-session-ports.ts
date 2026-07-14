// Bridge-session + bridge-message store ports, split out of ports.ts to keep
// that file under the repo's 300-line cap (same precedent as memory-ports.ts /
// skill-ports.ts / bridge-token-ports.ts) and re-exported from there, so the
// public `@better-agent/agent/ports` surface is unchanged.

import type { BridgeAgentKind } from "./bridge-token-ports";

export type BridgeSessionStatus = "active" | "ended";

export interface BridgeSessionRow {
	agentKind: BridgeAgentKind;
	agentSessionId: string | null;
	createdAt: Date;
	id: string;
	label: string | null;
	lastSeenAt: Date;
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
	}): Promise<BridgeSessionRow>;
	end(id: string, userId: string): Promise<void>;
	get(id: string): Promise<BridgeSessionRow | null>;
	listByUser(userId: string): Promise<BridgeSessionRow[]>;
	/** One page of the user's sessions, newest first (createdAt DESC, id DESC
	 * tie-break). `before` resumes strictly after that cursor position; omit it
	 * for the first page. `tokenId` narrows the page to one bridge token's
	 * sessions. Returns at most `limit` rows. */
	listPageByUser(
		userId: string,
		opts: { limit: number; before?: BridgeSessionCursor; tokenId?: string }
	): Promise<BridgeSessionRow[]>;
	setAgentSessionId(id: string, agentSessionId: string): Promise<void>;
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
}
