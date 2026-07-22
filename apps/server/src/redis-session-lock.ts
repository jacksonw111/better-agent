import { randomUUID } from "node:crypto";
import type { SessionLock } from "@better-agent/agent/session/session-lock";
import { log } from "evlog";
import type { Redis } from "ioredis";

// A turn (multi-step tool loops) can run for minutes; the TTL only exists so a
// crashed instance cannot deadlock a session forever. Release is token-guarded
// so a turn that outlives the TTL never deletes a successor instance's lock.
//
// While a turn is in flight the lock is renewed on a heartbeat timer (PEXPIRE),
// so a legitimate long-running turn never lets the lock auto-expire and admit a
// second concurrent prompt for the same session. The TTL remains as the final
// safety net: if the holding process crashes, its heartbeat stops and the key
// expires on its own so a successor can take over.
export const LOCK_TTL_MS = 300_000;

// Renew well inside the TTL (~1/3) so several heartbeats can be missed — GC
// pauses, transient Redis blips — before the lock is ever at risk of expiring.
export const LOCK_RENEW_INTERVAL_MS = 100_000;

// KEYS[1]=lock key, ARGV[1]=token. Delete only if we still own it.
const RELEASE_SCRIPT =
	"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

// KEYS[1]=lock key, ARGV[1]=token, ARGV[2]=ttl ms. PEXPIRE only if we still own
// it, so we never extend a lock a successor has since taken over.
const RENEW_SCRIPT =
	"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

function keyFor(sessionId: string): string {
	return `sessionlock:${sessionId}`;
}

interface LockState {
	redis: Redis;
	timers: Map<string, ReturnType<typeof setInterval>>;
	tokens: Map<string, string>;
}

function stopHeartbeat(state: LockState, sessionId: string): void {
	const timer = state.timers.get(sessionId);
	if (timer !== undefined) {
		clearInterval(timer);
		state.timers.delete(sessionId);
	}
}

async function renew(
	state: LockState,
	sessionId: string,
	token: string
): Promise<void> {
	try {
		const renewed = await state.redis.eval(
			RENEW_SCRIPT,
			1,
			keyFor(sessionId),
			token,
			String(LOCK_TTL_MS)
		);
		// 0 means we no longer own the key (expired then re-taken); stop
		// heartbeating so we don't keep polling a lock that isn't ours.
		if (renewed === 0) {
			state.tokens.delete(sessionId);
			stopHeartbeat(state, sessionId);
		}
	} catch (err) {
		log.error({
			action: "redis session-lock renew failed",
			sessionId,
			error: String(err),
		});
	}
}

function startHeartbeat(
	state: LockState,
	sessionId: string,
	token: string
): void {
	const timer = setInterval(() => {
		renew(state, sessionId, token).catch((err) => {
			log.error({
				action: "redis session-lock heartbeat crashed",
				sessionId,
				error: String(err),
			});
		});
	}, LOCK_RENEW_INTERVAL_MS);
	// Don't let the heartbeat keep the process alive on its own.
	timer.unref?.();
	state.timers.set(sessionId, timer);
}

export function createRedisSessionLock(redis: Redis): SessionLock {
	const state: LockState = { redis, tokens: new Map(), timers: new Map() };

	redis.on("error", (err: Error) => {
		log.error({ action: "redis session-lock error", error: String(err) });
	});

	return {
		async acquire(sessionId) {
			const token = randomUUID();
			const res = await redis.set(
				keyFor(sessionId),
				token,
				"PX",
				LOCK_TTL_MS,
				"NX"
			);
			if (res === "OK") {
				state.tokens.set(sessionId, token);
				startHeartbeat(state, sessionId, token);
				return true;
			}
			return false;
		},
		async release(sessionId) {
			stopHeartbeat(state, sessionId);
			const token = state.tokens.get(sessionId);
			if (token === undefined) {
				return;
			}
			state.tokens.delete(sessionId);
			await redis.eval(RELEASE_SCRIPT, 1, keyFor(sessionId), token);
		},
	};
}
