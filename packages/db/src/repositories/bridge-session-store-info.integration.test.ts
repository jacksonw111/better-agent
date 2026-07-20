import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createBridgeSessionStore } from "./bridge-session-store";
import { createBridgeTokenStore } from "./bridge-token-store";

// The session's last-known model / permission mode (migration 0052). No agent
// SDK lets us READ either value back, so the row is the only place a finished
// session's settings survive — `tasks.resume` seeds the next run's startup
// config from it. Split out of bridge-session-store.integration.test.ts purely
// to keep that file under the repo's max-lines-per-file gate.

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

async function seedUser(email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

async function seedToken(userId: string): Promise<string> {
	const tokenStore = createBridgeTokenStore(db);
	const created = await tokenStore.create({
		userId,
		tokenHash: hashToken(generateToken("bt_")),
	});
	return created.id;
}

it("setLastSessionInfo records the reported model and permission mode", async () => {
	const store = createBridgeSessionStore(db);
	const userId = await seedUser("alice@x.com");
	const tokenId = await seedToken(userId);

	const created = await store.create({
		userId,
		tokenId,
		agentKind: "claude-code",
	});
	expect(created.lastModel).toBeNull();
	expect(created.lastPermissionMode).toBeNull();

	await store.setLastSessionInfo(created.id, {
		model: "sonnet",
		permissionMode: "plan",
	});

	const after = await store.get(created.id);
	expect(after?.lastModel).toBe("sonnet");
	expect(after?.lastPermissionMode).toBe("plan");
});

it("setLastSessionInfo leaves an omitted field alone (per-field read-backs)", async () => {
	const store = createBridgeSessionStore(db);
	const userId = await seedUser("alice@x.com");
	const tokenId = await seedToken(userId);
	const created = await store.create({
		userId,
		tokenId,
		agentKind: "claude-code",
	});
	await store.setLastSessionInfo(created.id, {
		model: "sonnet",
		permissionMode: "plan",
	});

	// A `model_changed` read-back carries only a model — the stored permission
	// mode must survive it (and vice versa).
	await store.setLastSessionInfo(created.id, { model: "opus" });
	await store.setLastSessionInfo(created.id, { permissionMode: "acceptEdits" });
	// Nothing to write at all: a no-op, not a blanking UPDATE.
	await store.setLastSessionInfo(created.id, {});

	const after = await store.get(created.id);
	expect(after?.lastModel).toBe("opus");
	expect(after?.lastPermissionMode).toBe("acceptEdits");
});
