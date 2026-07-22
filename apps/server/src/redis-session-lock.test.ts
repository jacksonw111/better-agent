import RedisMock from "ioredis-mock";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createRedisSessionLock,
	LOCK_RENEW_INTERVAL_MS,
	LOCK_TTL_MS,
} from "./redis-session-lock";

const KEY = "sessionlock:s1";
// A couple of full TTLs — long enough that an un-renewed lock would have expired.
const TWO_TTLS_MS = LOCK_TTL_MS * 2;
// Small slack past a boundary so a lock that should expire has definitely done so.
const SLACK_MS = 1000;

// ioredis-mock v8 shares a single in-memory store across all instances.
// Flush before each test so lock state does not bleed between tests.
beforeEach(async () => {
	await new RedisMock().flushall();
});

afterEach(() => {
	vi.useRealTimers();
});

it("grants the lock once and rejects a second holder cross-connection", async () => {
	const a = new RedisMock();
	const b = new RedisMock();
	const lockA = createRedisSessionLock(a);
	const lockB = createRedisSessionLock(b);
	expect(await lockA.acquire("s1")).toBe(true);
	expect(await lockB.acquire("s1")).toBe(false);
});

it("allows re-acquire after release", async () => {
	const redis = new RedisMock();
	const lock = createRedisSessionLock(redis);
	expect(await lock.acquire("s1")).toBe(true);
	await lock.release("s1");
	expect(await lock.acquire("s1")).toBe(true);
});

it("does not block a different session", async () => {
	const redis = new RedisMock();
	const lock = createRedisSessionLock(redis);
	expect(await lock.acquire("s1")).toBe(true);
	expect(await lock.acquire("s2")).toBe(true);
});

it("release only frees a lock this instance still holds (token-guarded)", async () => {
	const a = new RedisMock();
	const b = new RedisMock();
	const lockA = createRedisSessionLock(a);
	const lockB = createRedisSessionLock(b);
	await lockA.acquire("s1");
	// Simulate A's TTL expiring and B taking over:
	await a.del("sessionlock:s1");
	expect(await lockB.acquire("s1")).toBe(true);
	// A's late release must NOT remove B's lock:
	await lockA.release("s1");
	expect(await lockB.acquire("s1")).toBe(false);
});

it("renews the lock while the turn is in flight so it survives past the TTL", async () => {
	vi.useFakeTimers();
	const a = new RedisMock();
	const b = new RedisMock();
	const lockA = createRedisSessionLock(a);
	const lockB = createRedisSessionLock(b);
	expect(await lockA.acquire("s1")).toBe(true);
	// Drive time well past a single TTL; the heartbeat must keep renewing.
	await vi.advanceTimersByTimeAsync(TWO_TTLS_MS);
	// A second concurrent prompt for the same session is still rejected.
	expect(await lockB.acquire("s1")).toBe(false);
	await lockA.release("s1");
});

it("stops renewing after release and lets a successor acquire", async () => {
	vi.useFakeTimers();
	const a = new RedisMock();
	const b = new RedisMock();
	const lockA = createRedisSessionLock(a);
	const lockB = createRedisSessionLock(b);
	await lockA.acquire("s1");
	await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS);
	await lockA.release("s1");
	// The key is gone immediately after release; a successor gets it.
	expect(await lockB.acquire("s1")).toBe(true);
	// No stray timer should ever revive A's expired lock.
	await vi.advanceTimersByTimeAsync(TWO_TTLS_MS);
	expect(await b.get(KEY)).not.toBeNull();
});

it("renews only its own token and never a lock a successor now holds", async () => {
	vi.useFakeTimers();
	const a = new RedisMock();
	const lockA = createRedisSessionLock(a);
	await lockA.acquire("s1");
	// A successor overwrites the key with its own token and a fresh TTL.
	await a.set(KEY, "successor-token", "PX", LOCK_TTL_MS);
	// A's heartbeat fires while it thinks it still holds the lock.
	await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS);
	// The successor's TTL must NOT be bumped back to the full window.
	const pttl = await a.pttl(KEY);
	expect(pttl).toBeLessThanOrEqual(
		LOCK_TTL_MS - LOCK_RENEW_INTERVAL_MS + SLACK_MS
	);
	expect(await a.get(KEY)).toBe("successor-token");
});

it("lets the TTL expire the lock once a holder crashes and stops renewing", async () => {
	vi.useFakeTimers();
	const a = new RedisMock();
	const b = new RedisMock();
	const lockA = createRedisSessionLock(a);
	const lockB = createRedisSessionLock(b);
	await lockA.acquire("s1");
	// Simulate the holding process crashing: its heartbeat timer stops firing.
	vi.clearAllTimers();
	// With nobody renewing, the TTL is the final safety net.
	await vi.advanceTimersByTimeAsync(LOCK_TTL_MS + SLACK_MS);
	expect(await lockB.acquire("s1")).toBe(true);
});
