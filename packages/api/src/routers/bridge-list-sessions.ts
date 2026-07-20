import type {
	BridgeSessionCursor,
	BridgeSessionRow,
	RelayStore,
} from "@better-agent/agent/ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
	isAttentionEligible,
	readSessionAttention,
} from "../bridge/read-attention";
import type { SessionAttention } from "../bridge/session-attention";
import { userProcedure } from "../index";

// P2-T1 (docs/local-agent-workspace-plan.md): `listSessions` pagination +
// per-session attention — split out of bridge.ts to keep that file under the
// repo's 300-line cap (same precedent as bridge-usage.ts / bridge-token-mgmt.ts).

/** Default page size when `limit` is omitted (mirrors `history`'s pattern). */
const DEFAULT_SESSIONS_LIMIT = 30;
/** Hard cap on `limit`, bounding one request's rows AND attention reads. */
const MAX_SESSIONS_LIMIT = 100;
const listSessionsInput = z
	.object({
		/** P3-T1: `true` pages ONLY archived sessions (the archived view);
		 * omitted/false excludes them — the default sidebar never shows them. */
		archived: z.boolean().optional(),
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

/** Attaches the derived attention signal to one row (see
 * ../bridge/read-attention.ts for the eligibility gate and the bounded tails). */
async function withAttention(
	relayStore: RelayStore,
	row: BridgeSessionRow,
	nowMs: number
): Promise<BridgeSessionWithAttention> {
	if (!isAttentionEligible(row, nowMs)) {
		return { ...row, attention: null };
	}
	return { ...row, attention: await readSessionAttention(relayStore, row.id) };
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
			{ limit, archived: input?.archived, before, tokenId: input?.tokenId }
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
