import {
	MAX_WINDOW,
	type RelayDir,
	type RelayEvent,
	type RelayStore,
	WINDOW_TTL_SEC,
} from "@better-agent/agent/bridge/relay-store";
import { log } from "evlog";
import type { ChainableCommander, Redis } from "ioredis";

const LAST_INDEX = -1;
const WINDOW_START_INDEX = -MAX_WINDOW;
/**
 * TTL (seconds) applied to the seq counter key — deliberately much longer
 * than WINDOW_TTL_SEC. The counter must never reset while a session is still
 * realistically alive: consumers (web's maxSeenId, the CLI's afterIdRef)
 * hold a persistent high-water mark and filter id > mark, so if INCR ever
 * restarted at 1 after an idle gap, every post-reset event/command would be
 * silently dropped as "already seen". Refreshed on every append.
 */
export const SEQ_TTL_SEC = 86_400;

function seqKey(sessionId: string, dir: RelayDir): string {
	return `bridge:${sessionId}:${dir}:seq`;
}

function listKey(sessionId: string, dir: RelayDir): string {
	return `bridge:${sessionId}:${dir}`;
}

function channelFor(sessionId: string, dir: RelayDir): string {
	return `bridge:${sessionId}:${dir}`;
}

function logRelayError(action: string, err: Error): void {
	log.error({ action, error: String(err) });
}

/** Runs a pipeline and throws the first command error, if any — `.exec()`
 * itself never rejects per-command errors, it just reports them inline, so a
 * caller awaiting this the way it would a single command gets the same
 * fail-loud behavior the sequential calls it replaces used to have. */
async function execPipeline(pipeline: ChainableCommander): Promise<void> {
	const results = await pipeline.exec();
	for (const [err] of results ?? []) {
		if (err) {
			throw err;
		}
	}
}

async function appendEvent(
	redis: Redis,
	sessionId: string,
	dir: RelayDir,
	data: unknown
): Promise<number> {
	// INCR must happen first (and stay its own round trip) — the assigned id
	// is embedded in the payload the rest of the commands operate on. Once we
	// have it, the list write + both TTL refreshes + the live publish have no
	// ordering dependency on each other, so they're batched into a single
	// pipelined round trip instead of 5 sequential ones.
	const id = await redis.incr(seqKey(sessionId, dir));
	const event: RelayEvent = { id, data };
	const payload = JSON.stringify(event);
	const key = listKey(sessionId, dir);

	await execPipeline(
		redis
			.pipeline()
			.rpush(key, payload)
			.ltrim(key, WINDOW_START_INDEX, LAST_INDEX)
			.expire(key, WINDOW_TTL_SEC)
			.expire(seqKey(sessionId, dir), SEQ_TTL_SEC)
			.publish(channelFor(sessionId, dir), payload)
	);

	return id;
}

async function readEvents(
	redis: Redis,
	sessionId: string,
	dir: RelayDir,
	afterId: number
): Promise<RelayEvent[]> {
	const raw = await redis.lrange(listKey(sessionId, dir), 0, LAST_INDEX);
	// INCR (id allocation) and RPUSH (list insertion) are separate round
	// trips, so two concurrent appends can interleave and land in the list
	// out of id order. Sort here so read() always honors its "in order"
	// contract regardless of list order.
	return raw
		.map((item) => JSON.parse(item) as RelayEvent)
		.filter((event) => event.id > afterId)
		.sort((a, b) => a.id - b.id);
}

type ListenersByChannel = Map<string, Set<(event: RelayEvent) => void>>;

/** A dedicated ioredis connection in subscriber mode, routing incoming
 * messages to the listeners registered for their channel. */
function createSubscriberConnection(
	redis: Redis,
	listeners: ListenersByChannel
): Redis {
	const sub = redis.duplicate();
	sub.on("error", (err: Error) => {
		logRelayError("redis relay-store subscriber error", err);
	});
	sub.on("message", (channel: string, payload: string) => {
		const subs = listeners.get(channel);
		if (!subs) {
			return;
		}
		const event = JSON.parse(payload) as RelayEvent;
		for (const listener of subs) {
			listener(event);
		}
	});
	return sub;
}

/** Lazily-created, shared subscriber connection routing messages by channel. */
function createSubscriberRouter(redis: Redis) {
	let subscriber: Redis | null = null;
	const listeners: ListenersByChannel = new Map();

	function ensureSubscriber(): Redis {
		subscriber ??= createSubscriberConnection(redis, listeners);
		return subscriber;
	}

	function subscribe(
		channel: string,
		onEvent: (event: RelayEvent) => void
	): () => void {
		const sub = ensureSubscriber();
		let subs = listeners.get(channel);
		if (!subs) {
			subs = new Set();
			listeners.set(channel, subs);
			sub.subscribe(channel).catch((err: Error) => {
				logRelayError("redis relay-store subscribe error", err);
			});
		}
		subs.add(onEvent);

		return () => {
			subs.delete(onEvent);
			if (subs.size === 0) {
				listeners.delete(channel);
				sub.unsubscribe(channel).catch((err: Error) => {
					logRelayError("redis relay-store unsubscribe error", err);
				});
			}
		};
	}

	return { subscribe };
}

export function createRedisRelayStore(redis: Redis): RelayStore {
	redis.on("error", (err: Error) => {
		logRelayError("redis relay-store error", err);
	});

	const router = createSubscriberRouter(redis);

	return {
		append: (sessionId, dir, data) => appendEvent(redis, sessionId, dir, data),

		read: (sessionId, dir, afterId) =>
			readEvents(redis, sessionId, dir, afterId),

		subscribe: (sessionId, dir, onEvent) =>
			router.subscribe(channelFor(sessionId, dir), onEvent),
	};
}
