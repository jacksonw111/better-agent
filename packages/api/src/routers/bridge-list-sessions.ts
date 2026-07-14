import type {
	BridgeSessionCursor,
	BridgeSessionRow,
	RelayStore,
} from "@better-agent/agent/ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
	deriveSessionAttention,
	type SessionAttention,
} from "../bridge/session-attention";
import { userProcedure } from "../index";

// P2-T1 (docs/local-agent-workspace-plan.md): `listSessions` pagination +
// per-session attention — split out of bridge.ts to keep that file under the
// repo's 300-line cap (same precedent as bridge-usage.ts / bridge-token-mgmt.ts).

/** Default page size when `limit` is omitted (mirrors `history`'s pattern). */
const DEFAULT_SESSIONS_LIMIT = 30;
/** Hard cap on `limit`, bounding one request's rows AND attention reads. */
const MAX_SESSIONS_LIMIT = 100;
/** How many trailing relay events/commands to inspect per session for the
 * attention signal — a bounded tail, never the full replay window. */
const ATTENTION_TAIL_LIMIT = 50;
/** Attention is only derived for sessions seen within this window (5 min);
 * anything staler is offline, so "waiting on you"/"working" would mislead. */
const ATTENTION_RECENCY_MS = 300_000;

const listSessionsInput = z
	.object({
		/** Opaque `nextCursor` from the previous page; omit for the first page. */
		cursor: z.string().optional(),
		limit: z
			.number()
			.int()
			.min(1)
			.max(MAX_SESSIONS_LIMIT)
			.default(DEFAULT_SESSIONS_LIMIT),
		/** Narrows the page to one bridge token's sessions, so "Load more" in a
		 * single agent's workspace pages through THAT agent's history instead of
		 * the user's interleaved sessions across all agents. */
		tokenId: z.string().optional(),
	})
	// The whole input is optional so existing `listSessions()` callers (no
	// args) keep working as "first page, default limit".
	.optional();

/** A session row as `listSessions` returns it: the stored row plus the
 * derived attention signal. */
export type BridgeSessionWithAttention = BridgeSessionRow & {
	attention: SessionAttention;
};

/** Encodes a page-boundary row into the opaque cursor the next call passes
 * back — `<createdAt epoch ms>:<session uuid>`, matching the keyset order of
 * `BridgeSessionStore.listPageByUser`. */
export function encodeSessionCursor(row: BridgeSessionRow): string {
	return `${new Date(row.createdAt).getTime()}:${row.id}`;
}

/** Decodes an incoming cursor, rejecting anything malformed with BAD_REQUEST
 * (a client should only ever echo back a server-minted `nextCursor`). */
export function decodeSessionCursor(cursor: string): BridgeSessionCursor {
	const separator = cursor.indexOf(":");
	const ms = Number(cursor.slice(0, separator));
	const id = cursor.slice(separator + 1);
	if (separator <= 0 || !Number.isFinite(ms) || id.length === 0) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Malformed listSessions cursor",
		});
	}
	return { createdAt: new Date(ms), id };
}

/** Whether `row` is worth an attention read at all: ended sessions are never
 * "working"/"waiting", and a session not seen recently is offline. */
function isAttentionEligible(row: BridgeSessionRow, nowMs: number): boolean {
	return (
		row.status !== "ended" &&
		nowMs - new Date(row.lastSeenAt).getTime() <= ATTENTION_RECENCY_MS
	);
}

/** Attaches the derived attention signal to one row. Best-effort: a relay
 * read failure degrades to `attention: null` rather than failing the whole
 * list — the signal is a hint, the rows are the data. */
async function withAttention(
	relayStore: RelayStore,
	row: BridgeSessionRow,
	nowMs: number
): Promise<BridgeSessionWithAttention> {
	if (!isAttentionEligible(row, nowMs)) {
		return { ...row, attention: null };
	}
	try {
		const [events, commands] = await Promise.all([
			relayStore.readTail(row.id, "events", ATTENTION_TAIL_LIMIT),
			relayStore.readTail(row.id, "commands", ATTENTION_TAIL_LIMIT),
		]);
		const attention = deriveSessionAttention(
			events.map((event) => event.data),
			commands.map((command) => command.data)
		);
		return { ...row, attention };
	} catch {
		return { ...row, attention: null };
	}
}

/** One newest-first page of the caller's sessions plus a `nextCursor` to
 * resume from (null once exhausted), each row carrying its attention signal. */
export const listSessions = userProcedure
	.input(listSessionsInput)
	.handler(async ({ input, context }) => {
		const limit = input?.limit ?? DEFAULT_SESSIONS_LIMIT;
		const before =
			input?.cursor === undefined
				? undefined
				: decodeSessionCursor(input.cursor);
		const rows = await context.services.stores.bridgeSession.listPageByUser(
			context.authedUser.id,
			{ limit, before, tokenId: input?.tokenId }
		);
		const nowMs = Date.now();
		const sessions = await Promise.all(
			rows.map((row) => withAttention(context.services.relayStore, row, nowMs))
		);
		const last = rows.at(-1);
		const nextCursor =
			rows.length === limit && last ? encodeSessionCursor(last) : null;
		return { sessions, nextCursor };
	});
