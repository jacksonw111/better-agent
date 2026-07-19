import type { ProjectInsert } from "@better-agent/agent/project-ports";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { computers } from "../schema/computers";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createProjectStore } from "./project-store";

// The user-plane `update` (projects.update / projects.retryClone): an
// owner-scoped partial edit — a rename touches only the name, while the
// router's re-clone patch resets the clone state so the row re-enters the
// clone-delivery queue. Split from project-store.integration.test.ts to stay
// under the per-file line cap.

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

async function seedComputer(userId: string): Promise<string> {
	const [row] = await db
		.insert(computers)
		.values({ userId, publicKeyPem: "pem", name: "John's MacBook" })
		.returning();
	return row?.id ?? "";
}

function projectInput(userId: string, computerId: string): ProjectInsert {
	return {
		computerId,
		encryptedToken: "iv:tag:ciphertext",
		name: "Better Agent",
		repoCloneUrl: "https://github.com/acme/better-agent.git",
		repoFullName: "acme/better-agent",
		tokenLast4: "wxyz",
		userId,
	};
}

it("update edits fields owner-scoped and returns the updated row", async () => {
	const store = createProjectStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const computerId = await seedComputer(alice);
	const created = await store.insert(projectInput(alice, computerId));

	// A non-owner (and an unknown id) edit nothing and see null — no oracle.
	expect(await store.update(created.id, bob, { name: "Stolen" })).toBeNull();
	expect(
		await store.update("00000000-0000-4000-8000-000000000000", alice, {
			name: "Ghost",
		})
	).toBeNull();
	expect((await store.getById(created.id, alice))?.name).toBe("Better Agent");

	// A rename touches ONLY the name — the clone/credential fields survive.
	const renamed = await store.update(created.id, alice, { name: "Renamed" });
	expect(renamed?.name).toBe("Renamed");
	expect(renamed?.repoCloneUrl).toBe(
		"https://github.com/acme/better-agent.git"
	);
	expect(renamed?.encryptedToken).toBe("iv:tag:ciphertext");
	expect(renamed?.status).toBe("created");
});

it("update resets the clone state when the repo or token changes", async () => {
	const store = createProjectStore(db);
	const alice = await seedUser("alice@x.com");
	const computerId = await seedComputer(alice);
	const created = await store.insert(projectInput(alice, computerId));
	await store.updateStatus(created.id, {
		localPath: "/Users/alice/.better-agent/projects/abcd1234-better-agent",
		status: "ready",
	});

	// The router's re-clone patch: new repo + cleared clone state, back to the
	// `created` queue. The untouched token fields survive the edit.
	const requeued = await store.update(created.id, alice, {
		errorMessage: null,
		localPath: null,
		repoCloneUrl: "https://gitlab.example.com/group/agent.git",
		repoFullName: "group/agent",
		status: "created",
	});
	expect(requeued?.status).toBe("created");
	expect(requeued?.repoCloneUrl).toBe(
		"https://gitlab.example.com/group/agent.git"
	);
	expect(requeued?.repoFullName).toBe("group/agent");
	expect(requeued?.localPath).toBeNull();
	expect(requeued?.errorMessage).toBeNull();
	expect(requeued?.encryptedToken).toBe("iv:tag:ciphertext");
	expect(requeued?.tokenLast4).toBe("wxyz");
	// Back in the clone-delivery queue.
	expect(
		(await store.listCreatedByComputer(computerId)).map((row) => row.id)
	).toEqual([created.id]);
});
