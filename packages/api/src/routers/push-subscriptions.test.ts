import { expect, it } from "vitest";
import { ALICE, BOB, build } from "./bridge-test-helpers";

// P3-T3: user-plane push subscription routes (push-subscriptions.ts).

const UNAVAILABLE_MESSAGE = /Web Push is unavailable/;

const SUB = {
	endpoint: "https://push.example.com/sub/alice-1",
	keys: { p256dh: "p256dh-key", auth: "auth-secret" },
};

it("vapidPublicKey returns the configured key, or null when push is disabled", async () => {
	const fixture = build();
	const alice = fixture.userClientFor(ALICE);
	expect(await alice.pushSubscriptions.vapidPublicKey()).toEqual({
		key: "test-vapid-public-key",
	});
	fixture.services.push = null;
	expect(await alice.pushSubscriptions.vapidPublicKey()).toEqual({
		key: null,
	});
});

it("subscribe upserts the caller's subscription keyed by endpoint", async () => {
	const fixture = build();
	const alice = fixture.userClientFor(ALICE);
	await alice.pushSubscriptions.subscribe(SUB);
	// Same endpoint again (e.g. page reload re-syncs) must not duplicate.
	await alice.pushSubscriptions.subscribe({
		...SUB,
		keys: { p256dh: "rotated-key", auth: "auth-secret" },
	});
	const rows = fixture.pushSubscription.rows();
	expect(rows).toHaveLength(1);
	expect(rows[0]?.userId).toBe(ALICE.id);
	expect(rows[0]?.p256dh).toBe("rotated-key");
});

it("subscribe fails clearly when VAPID keys are not configured", async () => {
	const fixture = build();
	fixture.services.push = null;
	const alice = fixture.userClientFor(ALICE);
	await expect(alice.pushSubscriptions.subscribe(SUB)).rejects.toThrow(
		UNAVAILABLE_MESSAGE
	);
	expect(fixture.pushSubscription.rows()).toHaveLength(0);
});

it("unsubscribe is owner-guarded and works even with push disabled", async () => {
	const fixture = build();
	const alice = fixture.userClientFor(ALICE);
	await alice.pushSubscriptions.subscribe(SUB);
	// Another user cannot drop Alice's subscription by guessing the endpoint.
	await fixture
		.userClientFor(BOB)
		.pushSubscriptions.unsubscribe({ endpoint: SUB.endpoint });
	expect(fixture.pushSubscription.rows()).toHaveLength(1);
	// Cleanup must still work after the server lost its VAPID keys.
	fixture.services.push = null;
	await alice.pushSubscriptions.unsubscribe({ endpoint: SUB.endpoint });
	expect(fixture.pushSubscription.rows()).toHaveLength(0);
});
