# Agent Task Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real, user-scoped Jira-style Kanban board (`/board`) whose only backend is the agent's tool layer, reached exclusively through the existing user-session SSE stream — no bespoke REST API.

**Architecture:** One interface (the `userSessions.prompt` SSE stream) accepts two input shapes: a model turn (`{ text }`) or a direct batch (`{ toolCalls: [...] }`) that executes named server tools concurrently with no model and streams each `tool-result` back the instant it resolves. The board fires three minimal `listColumn` reads on entry and paints each column as its data arrives. Drag/create/delete call single tools directly (optimistic); the floating chat goes through the model and can drive the page.

**Tech Stack:** drizzle-orm + PGlite (tests), zod v4, oRPC async-generator streaming, AI SDK v6 `ToolDef`, TanStack Router/Query, `@dnd-kit/core` + `@dnd-kit/sortable`, `@better-agent/ui` (shadcn), vitest.

## Global Constraints

- **One network interface only.** The board touches exactly one endpoint: the `userSessions.prompt` stream. NO `tasks.*` REST procedures, NO `callTool` procedure, NO new transport.
- **Frontend = shadcn only.** Every UI element uses `@better-agent/ui` components (Card, Button, Input, Textarea, Dialog, Badge, Separator, Skeleton, DropdownMenu, etc.). Exceptions: layout containers (flex/grid wrappers) and the dnd-kit drag primitives, which wrap ui components. `scroll-area` does NOT exist in the ui package — use plain `overflow-y-auto`.
- **Frontend UX bar (every UI task, not just polish).** Hold a consistent spacing/sizing scale in mind at all times — a "ruler": aligned edges, consistent gaps (use the same `gap-*`/`p-*` rhythm across columns, cards, modal), deliberate typography hierarchy. Layouts must be **scalable/responsive** (degrade cleanly from wide to mobile). Every async surface has a **loading state** (skeleton/spinner) and a **transition** (motion-reduce-safe `animate-in`). Every failure path shows a **visible error** (toast) — never fail silently. Empty states are intentional, not blank. This bar applies as each component is built; Task 12 is final polish, not where UX starts.
- **Minimal tools + stream-as-resolved.** Each tool is single-responsibility and returns one slice of data. A page fan-outs several reads in one trigger; each result paints the moment it is ready, in completion order. Never block first paint on the slowest tool.
- **User-scoped, always.** Every TaskStore method takes `userId` and filters by it. A user can never read or mutate another user's task. The direct-exec path and the model path both bind tools to `context.authedUser.id`.
- **DB migrations:** use `db:generate` then `db:migrate` (never `db:push`). The shared local DB is used by foreign tables.
- **Lint (CI runs biome + eslint, both block):** no `any` (use `unknown`); no magic numbers except `-1, 0, 1` (extract named constants); `consistent-return`; `useAwait` (no async fn without await); files ≤ 300 lines (HARD cap, `scripts/check-file-rules.js`); functions/component-callbacks ≤ 50 lines; `package.json` deps pinned exactly (no `^`/`~`). Run `pnpm dlx ultracite fix` before each commit.
- **Branch/deploy:** work on `dev`. Deploy happens via the GitHub Action on push to `dev` — do NOT deploy locally. Each task commits to `dev`.
- **Per-package tests:** `pnpm -F <pkg> test` (e.g. `pnpm -F @better-agent/db test`). DB tests are `*.integration.test.ts`; they spin a fresh PGlite and run real migrations, so Task 1's migration must exist before its test passes.

---

## File Structure

**Backend (packages):**
- `packages/agent/src/task/types.ts` (new) — `TaskStatus`, `Task` domain types.
- `packages/agent/src/ports.ts` (modify) — add `TaskStore` port interface.
- `packages/db/src/schema/task-board.ts` (new) — `tasks` table.
- `packages/db/src/schema/index.ts` (modify) — re-export the new table.
- `packages/db/src/migrations/*` (generated) — the `tasks` migration.
- `packages/db/src/repositories/task-store.ts` (new) — `createTaskStore(db)`.
- `packages/agent/src/tool/task-tools.ts` (new) — `buildTaskToolDefs(store, userId)`.
- `packages/agent/src/session/events.ts` (modify) — add optional `name?` to `tool-result`.
- `packages/api/src/routers/sessions.ts` (modify) — `toolCallsInput` + `promptOrToolCallsInput`.
- `packages/api/src/routers/user-sessions.ts` (modify) — `streamToolCalls`, branch in `prompt`, bind task tools into the model turn.
- `packages/api/src/services.ts` (modify) — add `task: TaskStore` to `stores`.
- `apps/server/src/services.ts` (modify) — construct + wire `taskStore`.
- `packages/client/src/types.ts` (modify) — `runTools`/`runTool` + result types on `AgentClient`.
- `packages/client/src/internal.ts` (modify) — implement them on the user-plane client.

**Frontend (apps/web):**
- `apps/web/src/board/board-store.ts` (new) — pure helpers + `createBoardStore()`.
- `apps/web/src/board/board-client.ts` (new) — column reads + single-op mutations over the SDK.
- `apps/web/src/board/task-card.tsx` (new) — one card (shadcn Card).
- `apps/web/src/board/task-column.tsx` (new) — one column (sortable + skeleton).
- `apps/web/src/board/task-board.tsx` (new) — orchestration (fan-out + dnd context).
- `apps/web/src/board/task-modal.tsx` (new) — detail Dialog.
- `apps/web/src/board/board-chat.tsx` (new) — floating chat.
- `apps/web/src/board/board-page.tsx` (new) — page composition (board + chat).
- `apps/web/src/routes/board.tsx` (new) — `/board` route.
- `apps/web/src/components/sidebar.tsx` (modify) — add the Board nav item.
- `apps/web/package.json` (modify) — add `@dnd-kit/core`, `@dnd-kit/sortable` (pinned).

---

## Task 1: `tasks` table, `TaskStore` port, repository + migration

**Files:**
- Create: `packages/agent/src/task/types.ts`
- Modify: `packages/agent/src/ports.ts`
- Create: `packages/db/src/schema/task-board.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/repositories/task-store.ts`
- Test: `packages/db/src/repositories/task-store.integration.test.ts`

**Interfaces:**
- Produces: `TaskStatus = "todo" | "in_progress" | "done"`; `Task` (id, userId, title, description, status, position, createdAt, updatedAt — all strings except position:number). `TaskStore` with `listColumn(userId, status)`, `list(userId)`, `create(userId, {title, status?})`, `update(userId, id, {title?, description?})`, `move(userId, id, status, position)`, `remove(userId, id)`, `get(userId, id)`. `createTaskStore(db): TaskStore`.

- [ ] **Step 1: Domain types.** Create `packages/agent/src/task/types.ts`:

```ts
export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
	createdAt: string;
	description: string;
	id: string;
	position: number;
	status: TaskStatus;
	title: string;
	updatedAt: string;
	userId: string;
}
```

- [ ] **Step 2: Port interface.** In `packages/agent/src/ports.ts`, add an import for the task types and append the `TaskStore` interface (place the import beside the other `./session/types` imports; if the file imports session types via `from "./session/types"`, add a sibling `import type { Task, TaskStatus } from "./task/types";`):

```ts
export interface TaskStore {
	create(
		userId: string,
		input: { status?: TaskStatus; title: string }
	): Promise<Task>;
	get(userId: string, id: string): Promise<Task | null>;
	list(userId: string): Promise<Task[]>;
	listColumn(userId: string, status: TaskStatus): Promise<Task[]>;
	move(
		userId: string,
		id: string,
		status: TaskStatus,
		position: number
	): Promise<Task | null>;
	remove(userId: string, id: string): Promise<boolean>;
	update(
		userId: string,
		id: string,
		patch: { description?: string; title?: string }
	): Promise<Task | null>;
}
```

- [ ] **Step 3: Schema table.** Create `packages/db/src/schema/task-board.ts`:

```ts
import {
	doublePrecision,
	index,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type { TaskStatus } from "@better-agent/agent/task/types";

export const tasks = pgTable(
	"tasks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id").notNull(),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		status: text("status").$type<TaskStatus>().notNull().default("todo"),
		position: doublePrecision("position").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("tasks_user_id").on(table.userId),
		index("tasks_user_status_position").on(
			table.userId,
			table.status,
			table.position
		),
	]
);
```

- [ ] **Step 4: Barrel export.** In `packages/db/src/schema/index.ts`, add `export * from "./task-board";` in alphabetical position with the other re-exports.

- [ ] **Step 5: Generate the migration.**

Run: `pnpm -F @better-agent/db db:generate`
Expected: a new SQL file under `packages/db/src/migrations/` creating `tasks` with both indexes, and an updated `_journal.json`.

- [ ] **Step 6: Repository.** Create `packages/db/src/repositories/task-store.ts`:

```ts
import type { TaskStore } from "@better-agent/agent/ports";
import type { Task, TaskStatus } from "@better-agent/agent/task/types";
import { and, asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type TaskRow = typeof schema.tasks.$inferSelect;

function toTask(row: TaskRow): Task {
	return {
		id: row.id,
		userId: row.userId,
		title: row.title,
		description: row.description,
		status: row.status,
		position: row.position,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

const owned = (userId: string, id: string) =>
	and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId));

async function nextPosition(
	db: Db,
	userId: string,
	status: TaskStatus
): Promise<number> {
	const rows = await db
		.select()
		.from(schema.tasks)
		.where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.status, status)));
	const max = rows.reduce((m, r) => Math.max(m, r.position), 0);
	return max + 1;
}

export function createTaskStore(db: Db): TaskStore {
	return {
		async list(userId) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(eq(schema.tasks.userId, userId))
				.orderBy(asc(schema.tasks.position));
			return rows.map(toTask);
		},
		async listColumn(userId, status) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(
					and(eq(schema.tasks.userId, userId), eq(schema.tasks.status, status))
				)
				.orderBy(asc(schema.tasks.position));
			return rows.map(toTask);
		},
		async get(userId, id) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(owned(userId, id))
				.limit(1);
			return rows[0] ? toTask(rows[0]) : null;
		},
		async create(userId, input) {
			const status = input.status ?? "todo";
			const position = await nextPosition(db, userId, status);
			const rows = await db
				.insert(schema.tasks)
				.values({ userId, title: input.title, status, position })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create task");
			}
			return toTask(row);
		},
		async update(userId, id, patch) {
			const rows = await db
				.update(schema.tasks)
				.set({ ...patch, updatedAt: new Date() })
				.where(owned(userId, id))
				.returning();
			return rows[0] ? toTask(rows[0]) : null;
		},
		async move(userId, id, status, position) {
			const rows = await db
				.update(schema.tasks)
				.set({ status, position, updatedAt: new Date() })
				.where(owned(userId, id))
				.returning();
			return rows[0] ? toTask(rows[0]) : null;
		},
		async remove(userId, id) {
			const rows = await db
				.delete(schema.tasks)
				.where(owned(userId, id))
				.returning();
			return rows.length > 0;
		},
	};
}
```

- [ ] **Step 7: Write the failing test.** Create `packages/db/src/repositories/task-store.integration.test.ts`:

```ts
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createTaskStore } from "./task-store";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});
afterEach(async () => {
	await client.close();
});

it("create defaults to todo and increments position", async () => {
	const store = createTaskStore(db);
	const a = await store.create(USER_A, { title: "first" });
	const b = await store.create(USER_A, { title: "second" });
	expect(a.status).toBe("todo");
	expect(b.position).toBeGreaterThan(a.position);
});

it("listColumn returns only that user's column, sorted by position", async () => {
	const store = createTaskStore(db);
	await store.create(USER_A, { title: "todo-1" });
	const moved = await store.create(USER_A, { title: "doing-1" });
	await store.move(USER_A, moved.id, "in_progress", 1);
	await store.create(USER_B, { title: "other-user" });
	const todo = await store.listColumn(USER_A, "todo");
	const doing = await store.listColumn(USER_A, "in_progress");
	expect(todo.map((t) => t.title)).toEqual(["todo-1"]);
	expect(doing.map((t) => t.title)).toEqual(["doing-1"]);
});

it("a user cannot get/update/move/remove another user's task", async () => {
	const store = createTaskStore(db);
	const a = await store.create(USER_A, { title: "secret" });
	expect(await store.get(USER_B, a.id)).toBeNull();
	expect(await store.update(USER_B, a.id, { title: "hax" })).toBeNull();
	expect(await store.move(USER_B, a.id, "done", 1)).toBeNull();
	expect(await store.remove(USER_B, a.id)).toBe(false);
});

it("update patches description and remove deletes", async () => {
	const store = createTaskStore(db);
	const a = await store.create(USER_A, { title: "t" });
	const updated = await store.update(USER_A, a.id, { description: "details" });
	expect(updated?.description).toBe("details");
	expect(await store.remove(USER_A, a.id)).toBe(true);
	expect(await store.get(USER_A, a.id)).toBeNull();
});
```

- [ ] **Step 8: Run the test.**

Run: `pnpm -F @better-agent/db test src/repositories/task-store.integration.test.ts`
Expected: 4 passing tests. (If migration not found, re-run Step 5.)

- [ ] **Step 9: Lint + commit.**

```bash
pnpm dlx ultracite fix
git add packages/agent/src/task packages/agent/src/ports.ts packages/db/src/schema packages/db/src/migrations packages/db/src/repositories/task-store.ts packages/db/src/repositories/task-store.integration.test.ts
git commit -m "feat(board): tasks table, TaskStore port + repository"
```

---

## Task 2: `buildTaskToolDefs` task tools

**Files:**
- Create: `packages/agent/src/tool/task-tools.ts`
- Test: `packages/agent/src/tool/task-tools.test.ts`

**Interfaces:**
- Consumes: `TaskStore` (Task 1), `ToolDef`/`ExecuteResult`/`ToolContext` from `./types`.
- Produces: `buildTaskToolDefs(store: TaskStore, userId: string): ToolDef[]` with tools `listColumn`, `createTask`, `moveTask`, `updateTask`, `deleteTask`, `getTask`. Each `execute` returns `{ output: JSON.stringify(result) }`; not-found returns `{ output: JSON.stringify({ error: "not_found" }), isError: true }`.

- [ ] **Step 1: Write the tools.** Create `packages/agent/src/tool/task-tools.ts`:

```ts
import type { TaskStore } from "../ports";
import type { TaskStatus } from "../task/types";
import type { ExecuteResult, JsonSchema, ToolDef } from "./types";

const STATUS_VALUES: TaskStatus[] = ["todo", "in_progress", "done"];

const statusSchema = {
	type: "string",
	enum: STATUS_VALUES,
} as const;

const ok = (value: unknown): ExecuteResult => ({
	output: JSON.stringify(value),
});
const notFound = (): ExecuteResult => ({
	output: JSON.stringify({ error: "not_found" }),
	isError: true,
});

function asString(args: unknown, key: string): string {
	const value = (args as Record<string, unknown>)[key];
	if (typeof value !== "string") {
		throw new Error(`Missing string arg: ${key}`);
	}
	return value;
}

function optionalString(args: unknown, key: string): string | undefined {
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

function asStatus(value: unknown): TaskStatus {
	if (STATUS_VALUES.includes(value as TaskStatus)) {
		return value as TaskStatus;
	}
	throw new Error(`Invalid status: ${String(value)}`);
}

const objectSchema = (
	properties: JsonSchema,
	required: string[]
): JsonSchema => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});

export function buildTaskToolDefs(
	store: TaskStore,
	userId: string
): ToolDef[] {
	return [
		{
			name: "listColumn",
			description:
				"List the current user's tasks in one column (status). Returns an array.",
			parameters: objectSchema({ status: statusSchema }, ["status"]),
			execute: async (args) =>
				ok(await store.listColumn(userId, asStatus(
					(args as Record<string, unknown>).status
				))),
		},
		{
			name: "createTask",
			description: "Create a task for the current user. Defaults to the todo column.",
			parameters: objectSchema(
				{ title: { type: "string" }, status: statusSchema },
				["title"]
			),
			execute: async (args) => {
				const status = optionalString(args, "status");
				return ok(
					await store.create(userId, {
						title: asString(args, "title"),
						status: status ? asStatus(status) : undefined,
					})
				);
			},
		},
		{
			name: "moveTask",
			description: "Move a task to a column and position.",
			parameters: objectSchema(
				{
					id: { type: "string" },
					status: statusSchema,
					position: { type: "number" },
				},
				["id", "status", "position"]
			),
			execute: async (args) => {
				const record = args as Record<string, unknown>;
				const moved = await store.move(
					userId,
					asString(args, "id"),
					asStatus(record.status),
					typeof record.position === "number" ? record.position : 0
				);
				return moved ? ok(moved) : notFound();
			},
		},
		{
			name: "updateTask",
			description: "Update a task's title and/or description.",
			parameters: objectSchema(
				{
					id: { type: "string" },
					title: { type: "string" },
					description: { type: "string" },
				},
				["id"]
			),
			execute: async (args) => {
				const updated = await store.update(userId, asString(args, "id"), {
					title: optionalString(args, "title"),
					description: optionalString(args, "description"),
				});
				return updated ? ok(updated) : notFound();
			},
		},
		{
			name: "deleteTask",
			description: "Delete a task.",
			parameters: objectSchema({ id: { type: "string" } }, ["id"]),
			execute: async (args) => {
				const removed = await store.remove(userId, asString(args, "id"));
				return removed ? ok({ ok: true }) : notFound();
			},
		},
		{
			name: "getTask",
			description: "Get one task by id.",
			parameters: objectSchema({ id: { type: "string" } }, ["id"]),
			execute: async (args) => {
				const task = await store.get(userId, asString(args, "id"));
				return task ? ok(task) : notFound();
			},
		},
	];
}
```

If this file approaches 300 lines, split the schema helpers into `packages/agent/src/tool/task-tools-schema.ts` and import them. (It should land near ~150 lines.)

- [ ] **Step 2: Write the failing test.** Create `packages/agent/src/tool/task-tools.test.ts`:

```ts
import { expect, it } from "vitest";
import type { TaskStore } from "../ports";
import type { Task } from "../task/types";
import { buildTaskToolDefs } from "./task-tools";

const USER = "user-1";

function fakeStore(): TaskStore {
	const rows: Task[] = [];
	let n = 0;
	const stamp = "2026-06-30T00:00:00.000Z";
	return {
		list: (u) => Promise.resolve(rows.filter((r) => r.userId === u)),
		listColumn: (u, status) =>
			Promise.resolve(
				rows.filter((r) => r.userId === u && r.status === status)
			),
		get: (u, id) =>
			Promise.resolve(rows.find((r) => r.userId === u && r.id === id) ?? null),
		create: (u, input) => {
			n += 1;
			const task: Task = {
				id: `t${n}`,
				userId: u,
				title: input.title,
				description: "",
				status: input.status ?? "todo",
				position: n,
				createdAt: stamp,
				updatedAt: stamp,
			};
			rows.push(task);
			return Promise.resolve(task);
		},
		update: (u, id, patch) => {
			const task = rows.find((r) => r.userId === u && r.id === id);
			if (!task) {
				return Promise.resolve(null);
			}
			Object.assign(task, patch);
			return Promise.resolve(task);
		},
		move: (u, id, status, position) => {
			const task = rows.find((r) => r.userId === u && r.id === id);
			if (!task) {
				return Promise.resolve(null);
			}
			task.status = status;
			task.position = position;
			return Promise.resolve(task);
		},
		remove: (u, id) => {
			const i = rows.findIndex((r) => r.userId === u && r.id === id);
			if (i === -1) {
				return Promise.resolve(false);
			}
			rows.splice(i, 1);
			return Promise.resolve(true);
		},
	};
}

const byName = (defs: ReturnType<typeof buildTaskToolDefs>, name: string) => {
	const def = defs.find((d) => d.name === name);
	if (!def) {
		throw new Error(`no tool ${name}`);
	}
	return def;
};

it("createTask then listColumn returns the task as JSON", async () => {
	const defs = buildTaskToolDefs(fakeStore(), USER);
	const created = await byName(defs, "createTask").execute(
		{ title: "hello" },
		ctx()
	);
	expect(JSON.parse(created.output).title).toBe("hello");
	const list = await byName(defs, "listColumn").execute(
		{ status: "todo" },
		ctx()
	);
	expect(JSON.parse(list.output)).toHaveLength(1);
});

it("moveTask on a missing id returns isError not_found", async () => {
	const defs = buildTaskToolDefs(fakeStore(), USER);
	const res = await byName(defs, "moveTask").execute(
		{ id: "nope", status: "done", position: 1 },
		ctx()
	);
	expect(res.isError).toBe(true);
	expect(JSON.parse(res.output).error).toBe("not_found");
});

function ctx() {
	return {
		abortSignal: new AbortController().signal,
		agentId: "a1",
		callId: "c1",
		messageId: "m1",
		sessionId: "s1",
	};
}
```

- [ ] **Step 3: Run the test.**

Run: `pnpm -F @better-agent/agent test src/tool/task-tools.test.ts`
Expected: 2 passing tests.

- [ ] **Step 4: Lint + commit.**

```bash
pnpm dlx ultracite fix
git add packages/agent/src/tool/task-tools.ts packages/agent/src/tool/task-tools.test.ts
git commit -m "feat(board): buildTaskToolDefs user-scoped task tools"
```

---

## Task 3: `toolCalls` stream mode + wire `taskStore` into services

**Files:**
- Modify: `packages/agent/src/session/events.ts`
- Modify: `packages/api/src/routers/sessions.ts`
- Modify: `packages/api/src/routers/user-sessions.ts`
- Modify: `packages/api/src/services.ts`
- Modify: `apps/server/src/services.ts`
- Test: `packages/api/src/routers/user-sessions-toolcalls.test.ts`

**Interfaces:**
- Consumes: `buildTaskToolDefs` (Task 2), `context.services.stores.task`.
- Produces: the `prompt` procedure accepts `{ sessionId, toolCalls: [{ callId, name, args }] }`; it yields one `{ type: "tool-result", callId, name, result, isError }` per call in completion order, then `{ type: "done" }`. `context.services.stores.task: TaskStore`.

- [ ] **Step 1: Add `name?` to the tool-result event.** In `packages/agent/src/session/events.ts`, change the `tool-result` variant to:

```ts
	| { type: "tool-result"; callId: string; name?: string; result: unknown; isError: boolean }
```

- [ ] **Step 2: Add the toolCalls input schema.** In `packages/api/src/routers/sessions.ts`, after `promptInput`, add and export:

```ts
const MAX_TOOL_CALLS = 16;

export const toolCallsInput = z.object({
	sessionId: z.uuid(),
	toolCalls: z
		.array(
			z.object({
				callId: z.string().min(1),
				name: z.string().min(1),
				args: z.record(z.string(), z.unknown()),
			})
		)
		.min(1)
		.max(MAX_TOOL_CALLS),
});

// toolCallsInput FIRST: a toolCalls-only payload must not be tried against
// promptInput (whose refine requires text or an attachment).
export const promptOrToolCallsInput = z.union([toolCallsInput, promptInput]);
```

- [ ] **Step 3: Add the `task` port type to the services interface.** In `packages/api/src/services.ts`, import the port type (with the other `@better-agent/agent/ports` imports) and add to the `stores` object:

```ts
		task: TaskStore;
```

(Add `TaskStore` to the existing `import type { ... } from "@better-agent/agent/ports";`.)

- [ ] **Step 4: Construct the store.** In `apps/server/src/services.ts`:
  1. Import: `import { createTaskStore } from "@better-agent/db/repositories/task-store";` (with the other repository imports).
  2. In `buildServices`, add `const taskStore = createTaskStore(db);` beside the other store constructions, and thread it into `buildStores` (add `task: taskStore` to the returned object, and add `task: ReturnType<typeof createTaskStore>` to the `buildStores` parts type + pass `task: taskStore` at the call site).

- [ ] **Step 5: Implement `streamToolCalls` + branch the handler.** In `packages/api/src/routers/user-sessions.ts`:
  1. Add imports: `import { buildTaskToolDefs } from "@better-agent/agent/tool/task-tools";` and update the `./sessions` import to also pull `promptOrToolCallsInput`.
  2. Add a settle-order merge helper and the generator (above the router object):

```ts
const NO_USAGE = null;

type ToolCallsInput = {
	sessionId: string;
	toolCalls: { args: Record<string, unknown>; callId: string; name: string }[];
};

async function* streamSettled(
	promises: Promise<RunEvent>[]
): AsyncGenerator<RunEvent> {
	const entries = promises.map((p) => {
		const entry = { done: false, settled: Promise.resolve<RunEvent | null>(null) };
		entry.settled = p.then((value) => {
			entry.done = true;
			return value;
		});
		return entry;
	});
	let remaining = entries.length;
	while (remaining > 0) {
		const pending = entries.filter((e) => !e.done).map((e) => e.settled);
		const value = await Promise.race(pending);
		remaining -= 1;
		if (value) {
			yield value;
		}
	}
}

async function executeToolCall(
	def: ToolDef | undefined,
	call: ToolCallsInput["toolCalls"][number],
	sessionId: string,
	signal: AbortSignal | undefined
): Promise<RunEvent> {
	if (!def) {
		return {
			type: "tool-result",
			callId: call.callId,
			name: call.name,
			result: JSON.stringify({ error: "unknown_tool" }),
			isError: true,
		};
	}
	try {
		const res = await def.execute(call.args, {
			abortSignal: signal ?? new AbortController().signal,
			agentId: "",
			callId: call.callId,
			messageId: "",
			sessionId,
		});
		return {
			type: "tool-result",
			callId: call.callId,
			name: call.name,
			result: res.output,
			isError: res.isError ?? false,
		};
	} catch (err) {
		return {
			type: "tool-result",
			callId: call.callId,
			name: call.name,
			result: JSON.stringify({ error: errorMessage(err) }),
			isError: true,
		};
	}
}

async function* streamToolCalls(
	context: UserSessionContext,
	userId: string,
	input: ToolCallsInput,
	signal: AbortSignal | undefined
): AsyncGenerator<RunEvent> {
	await requireUserSession(context, userId, input.sessionId);
	const defs = buildTaskToolDefs(context.services.stores.task, userId);
	const byName = new Map(defs.map((d) => [d.name, d] as const));
	const work = input.toolCalls.map((call) =>
		executeToolCall(byName.get(call.name), call, input.sessionId, signal)
	);
	yield* streamSettled(work);
	yield { type: "done", usage: NO_USAGE, finishReason: "stop" };
}
```

  Reuse the existing `errorMessage` helper / `UserSessionContext` type / `ToolDef` import already present in the file; add the `ToolDef` import from `@better-agent/agent/tool/types` if not already imported. `requireUserSession`'s return value is unused here (call it for the 404 guard only).

  3. Change the `prompt` handler to branch:

```ts
	prompt: authorizedUserProcedure
		.input(promptOrToolCallsInput)
		.handler(({ input, context, signal }) => {
			if ("toolCalls" in input) {
				return streamToolCalls(context, context.authedUser.id, input, signal);
			}
			return streamUserTurn(context, context.authedUser.id, input, signal);
		}),
```

- [ ] **Step 6: Write the failing test.** Create `packages/api/src/routers/user-sessions-toolcalls.test.ts`. Mirror the fake-services pattern from `user-sessions.test.ts` (copy its `buildServices`/context scaffolding), but add a real task store backed by PGlite OR a simple in-memory `TaskStore` fake assigned to `services.stores.task`. Use the in-memory fake to keep it a unit test:

```ts
import type { RunEvent } from "@better-agent/agent/session/events";
import type { TaskStore } from "@better-agent/agent/ports";
import type { Task } from "@better-agent/agent/task/types";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const USER = { id: "99999999-9999-9999-9999-999999999999", email: "u@x.io", createdAt: new Date() };

function memoryTaskStore(): TaskStore {
	const rows: Task[] = [];
	let n = 0;
	const s = "2026-06-30T00:00:00.000Z";
	return {
		list: (u) => Promise.resolve(rows.filter((r) => r.userId === u)),
		listColumn: (u, status) =>
			Promise.resolve(rows.filter((r) => r.userId === u && r.status === status)),
		get: (u, id) => Promise.resolve(rows.find((r) => r.userId === u && r.id === id) ?? null),
		create: (u, input) => {
			n += 1;
			const t: Task = { id: `t${n}`, userId: u, title: input.title, description: "", status: input.status ?? "todo", position: n, createdAt: s, updatedAt: s };
			rows.push(t);
			return Promise.resolve(t);
		},
		update: () => Promise.resolve(null),
		move: () => Promise.resolve(null),
		remove: () => Promise.resolve(false),
	};
}

function clientWithTasks(session: { id: string; userId: string }) {
	const task = memoryTaskStore();
	const services = {
		authz: { enabled: false },
		stores: {
			task,
			session: { get: () => Promise.resolve({ id: session.id, userId: session.userId, agentId: "a1" }) },
		},
	};
	return createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: USER,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
}

it("toolCalls mode runs tools directly and streams a result then done", async () => {
	const session = { id: "33333333-3333-3333-3333-333333333333", userId: USER.id };
	const client = clientWithTasks(session);
	const events: RunEvent[] = [];
	for await (const ev of await client.userSessions.prompt({
		sessionId: session.id,
		toolCalls: [{ callId: "c1", name: "createTask", args: { title: "from-tool" } }],
	})) {
		events.push(ev);
	}
	const result = events.find((e) => e.type === "tool-result");
	expect(result && JSON.parse(String(result.result)).title).toBe("from-tool");
	expect(events.at(-1)?.type).toBe("done");
});

it("an unknown tool name yields an isError result for that call only", async () => {
	const session = { id: "44444444-4444-4444-4444-444444444444", userId: USER.id };
	const client = clientWithTasks(session);
	const events: RunEvent[] = [];
	for await (const ev of await client.userSessions.prompt({
		sessionId: session.id,
		toolCalls: [{ callId: "c9", name: "nope", args: {} }],
	})) {
		events.push(ev);
	}
	const result = events.find((e) => e.type === "tool-result");
	expect(result?.isError).toBe(true);
});
```

Note: `requireUserSession` likely calls `context.services.stores.session.get` — the fake `session.get` above returns a matching `userId`, so the guard passes. If `requireUserSession` reads a different store method, adjust the fake to satisfy it (check `user-sessions.ts:70`).

- [ ] **Step 7: Run the test.**

Run: `pnpm -F @better-agent/api test src/routers/user-sessions-toolcalls.test.ts`
Expected: 2 passing tests.

- [ ] **Step 8: Lint + commit.**

```bash
pnpm dlx ultracite fix
git add packages/agent/src/session/events.ts packages/api/src/routers/sessions.ts packages/api/src/routers/user-sessions.ts packages/api/src/services.ts apps/server/src/services.ts packages/api/src/routers/user-sessions-toolcalls.test.ts
git commit -m "feat(board): toolCalls stream mode + wire taskStore"
```

---

## Task 4: SDK `runTools` / `runTool`

**Files:**
- Modify: `packages/client/src/types.ts`
- Modify: `packages/client/src/internal.ts`
- Test: `packages/client/src/run-tools.test.ts`

**Interfaces:**
- Consumes: `client.userSessions.prompt({ sessionId, toolCalls })` (Task 3).
- Produces: `AgentClient.runTools(sessionId, calls: ToolCallRequest[], onResult: (r: ToolCallResult) => void): Promise<void>` and `AgentClient.runTool(sessionId, name, args): Promise<unknown>`. Types `ToolCallRequest { callId; name; args }`, `ToolCallResult { callId; name; result; isError }`.

- [ ] **Step 1: Types.** In `packages/client/src/types.ts`, add the request/result types and the two methods to the `AgentClient` interface:

```ts
export interface ToolCallRequest {
	args: Record<string, unknown>;
	callId: string;
	name: string;
}

export interface ToolCallResult {
	callId: string;
	isError: boolean;
	name: string;
	result: unknown;
}
```

```ts
	runTool(
		sessionId: string,
		name: string,
		args: Record<string, unknown>
	): Promise<unknown>;
	runTools(
		sessionId: string,
		calls: ToolCallRequest[],
		onResult: (result: ToolCallResult) => void
	): Promise<void>;
```

- [ ] **Step 2: Implement on the user-plane client.** In `packages/client/src/internal.ts`, inside `createUserSessionClientFrom`, add (before the `return { ... }`) two named functions and include them in the returned object:

```ts
	const runTools: AgentClient["runTools"] = async (
		sessionId,
		calls,
		onResult
	) => {
		const stream = await client.userSessions.prompt({ sessionId, toolCalls: calls });
		for await (const event of stream) {
			if (event.type === "tool-result") {
				onResult({
					callId: event.callId,
					name: event.name ?? "",
					result: parseToolResult(event.result),
					isError: event.isError,
				});
			} else if (event.type === "error") {
				throw new Error(event.message);
			}
		}
	};

	const runTool: AgentClient["runTool"] = async (sessionId, name, args) => {
		const callId = crypto.randomUUID();
		let captured: ToolCallResult | undefined;
		await runTools(sessionId, [{ callId, name, args }], (result) => {
			if (result.callId === callId) {
				captured = result;
			}
		});
		if (!captured) {
			throw new Error(`No result for tool ${name}`);
		}
		if (captured.isError) {
			throw new Error(String(captured.result));
		}
		return captured.result;
	};
```

Add this helper near the top of the file (module scope):

```ts
function parseToolResult(raw: unknown): unknown {
	if (typeof raw !== "string") {
		return raw;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}
```

Then add `runTools, runTool,` to the returned object literal, and import `ToolCallResult` from `./types`.

- [ ] **Step 3: Write the failing test.** Create `packages/client/src/run-tools.test.ts`:

```ts
import type { RunEvent } from "@better-agent/api/routers/index";
import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { createUserSessionClientFrom } from "./internal";

function stub(events: RunEvent[], captured: { toolCalls?: unknown }) {
	return {
		userSessions: {
			create: () => Promise.resolve({ id: "s1" }),
			listMessages: () => Promise.resolve([]),
			run: () => Promise.resolve({}),
			prompt: (input: { toolCalls?: unknown }) => {
				captured.toolCalls = input.toolCalls;
				return (async function* () {
					for (const e of events) {
						yield e;
					}
				})();
			},
		},
	} as unknown as RouterClient<AppRouter>;
}

it("runTool sends one toolCall and resolves the parsed result", async () => {
	const captured: { toolCalls?: unknown } = {};
	const events: RunEvent[] = [
		{ type: "tool-result", callId: "x", name: "listColumn", result: JSON.stringify([{ id: "t1" }]), isError: false },
		{ type: "done", usage: null, finishReason: "stop" },
	];
	const sdk = createUserSessionClientFrom(stub(events, captured), "agent-1");
	const result = await sdk.runTool("s1", "listColumn", { status: "todo" });
	expect(result).toEqual([{ id: "t1" }]);
	expect(Array.isArray(captured.toolCalls)).toBe(true);
});

it("runTool rejects on an isError result", async () => {
	const events: RunEvent[] = [
		{ type: "tool-result", callId: "x", name: "moveTask", result: JSON.stringify({ error: "not_found" }), isError: true },
		{ type: "done", usage: null, finishReason: "stop" },
	];
	const sdk = createUserSessionClientFrom(stub(events, {}), "agent-1");
	await expect(sdk.runTool("s1", "moveTask", {})).rejects.toThrow();
});
```

Note: the stubbed `prompt` ignores the `callId` mismatch by returning a single result — `runTool` matches on its generated `callId`. Since the stub can't know the generated id, return the result with the SAME callId the SDK will generate is impossible; instead make `runTool` match by presence when there is exactly one call. **Adjust the impl**: in `runTool`, if `calls.length === 1`, capture the first result regardless of callId (it is the only call). Use: `(result) => { captured = result; }` for the single-call wrapper. Keep the `runTools` callId fidelity for multi-call use. Update Step 2's `runTool` accordingly (drop the `if (result.callId === callId)` guard since it's the only call).

- [ ] **Step 4: Run the test.**

Run: `pnpm -F @jacksonw111/agent-client test src/run-tools.test.ts`
Expected: 2 passing tests. (Confirm the package name with `packages/client/package.json`; use that filter.)

- [ ] **Step 5: Lint + commit.**

```bash
pnpm dlx ultracite fix
git add packages/client/src/types.ts packages/client/src/internal.ts packages/client/src/run-tools.test.ts
git commit -m "feat(board): SDK runTools/runTool over the stream"
```

---

## Task 5: Board pure logic + optimistic store

**Files:**
- Create: `apps/web/src/board/board-store.ts`
- Test: `apps/web/src/board/board-store.test.ts`

**Interfaces:**
- Produces: `BoardStatus`, `BoardTask`, `COLUMNS`; pure helpers `sortByPosition`, `groupByColumn`, `midpoint`, `nextPosition`; factory `createBoardStore()` returning `{ subscribe, getSnapshot, setColumn, applyMove, addLocal, replaceLocal, removeLocal }`.

- [ ] **Step 1: Write the module.** Create `apps/web/src/board/board-store.ts`:

```ts
export type BoardStatus = "todo" | "in_progress" | "done";

export interface BoardTask {
	description: string;
	id: string;
	position: number;
	status: BoardStatus;
	title: string;
}

export const COLUMNS: readonly { label: string; status: BoardStatus }[] = [
	{ status: "todo", label: "To Do" },
	{ status: "in_progress", label: "In Progress" },
	{ status: "done", label: "Done" },
];

const POSITION_GAP = 1;
const HALF = 2;

export function sortByPosition(tasks: BoardTask[]): BoardTask[] {
	return [...tasks].sort((a, b) => a.position - b.position);
}

export function groupByColumn(
	tasks: BoardTask[]
): Record<BoardStatus, BoardTask[]> {
	const groups: Record<BoardStatus, BoardTask[]> = {
		todo: [],
		in_progress: [],
		done: [],
	};
	for (const task of tasks) {
		groups[task.status].push(task);
	}
	for (const status of Object.keys(groups) as BoardStatus[]) {
		groups[status] = sortByPosition(groups[status]);
	}
	return groups;
}

export function nextPosition(column: BoardTask[]): number {
	return column.reduce((m, t) => Math.max(m, t.position), 0) + POSITION_GAP;
}

/** Fractional position between two neighbors (drag-drop target). */
export function midpoint(before?: BoardTask, after?: BoardTask): number {
	if (before && after) {
		return (before.position + after.position) / HALF;
	}
	if (before) {
		return before.position + POSITION_GAP;
	}
	if (after) {
		return after.position - POSITION_GAP;
	}
	return POSITION_GAP;
}

export function createBoardStore() {
	let cache: BoardTask[] = [];
	const listeners = new Set<() => void>();
	const emit = () => {
		for (const listener of listeners) {
			listener();
		}
	};
	const set = (next: BoardTask[]) => {
		cache = next;
		emit();
	};
	return {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => cache,
		setColumn(status: BoardStatus, tasks: BoardTask[]) {
			set([...cache.filter((t) => t.status !== status), ...tasks]);
		},
		addLocal(task: BoardTask) {
			set([...cache, task]);
		},
		replaceLocal(id: string, task: BoardTask) {
			set(cache.map((t) => (t.id === id ? task : t)));
		},
		applyMove(id: string, status: BoardStatus, position: number) {
			set(
				cache.map((t) => (t.id === id ? { ...t, status, position } : t))
			);
		},
		removeLocal(id: string) {
			set(cache.filter((t) => t.id !== id));
		},
	};
}

export type BoardStore = ReturnType<typeof createBoardStore>;
```

- [ ] **Step 2: Write the failing test.** Create `apps/web/src/board/board-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	type BoardTask,
	createBoardStore,
	groupByColumn,
	midpoint,
	nextPosition,
	sortByPosition,
} from "./board-store";

const task = (over: Partial<BoardTask>): BoardTask => ({
	id: "t",
	title: "t",
	description: "",
	status: "todo",
	position: 1,
	...over,
});

describe("pure helpers", () => {
	it("sortByPosition orders ascending", () => {
		const out = sortByPosition([task({ id: "b", position: 2 }), task({ id: "a", position: 1 })]);
		expect(out.map((t) => t.id)).toEqual(["a", "b"]);
	});

	it("groupByColumn buckets and sorts", () => {
		const groups = groupByColumn([
			task({ id: "d", status: "done", position: 1 }),
			task({ id: "a", status: "todo", position: 2 }),
			task({ id: "b", status: "todo", position: 1 }),
		]);
		expect(groups.todo.map((t) => t.id)).toEqual(["b", "a"]);
		expect(groups.done.map((t) => t.id)).toEqual(["d"]);
	});

	it("midpoint returns a value strictly between neighbors", () => {
		const mid = midpoint(task({ position: 1 }), task({ position: 2 }));
		expect(mid).toBeGreaterThan(1);
		expect(mid).toBeLessThan(2);
	});

	it("nextPosition is greater than the column max", () => {
		expect(nextPosition([task({ position: 3 })])).toBeGreaterThan(3);
	});
});

describe("createBoardStore", () => {
	it("setColumn replaces only that column and notifies", () => {
		const store = createBoardStore();
		let ticks = 0;
		store.subscribe(() => {
			ticks += 1;
		});
		store.setColumn("todo", [task({ id: "x", status: "todo" })]);
		store.setColumn("done", [task({ id: "y", status: "done" })]);
		expect(store.getSnapshot().map((t) => t.id).sort()).toEqual(["x", "y"]);
		expect(ticks).toBe(2);
	});

	it("applyMove changes status/position; removeLocal drops it", () => {
		const store = createBoardStore();
		store.setColumn("todo", [task({ id: "x" })]);
		store.applyMove("x", "done", 5);
		expect(store.getSnapshot()[0]).toMatchObject({ status: "done", position: 5 });
		store.removeLocal("x");
		expect(store.getSnapshot()).toHaveLength(0);
	});
});
```

- [ ] **Step 3: Run the test.**

Run: `pnpm -F web test src/board/board-store.test.ts`
Expected: passing. (Confirm the web package name in `apps/web/package.json` `name` field; use that filter.)

- [ ] **Step 4: Lint + commit.**

```bash
pnpm dlx ultracite fix
git add apps/web/src/board/board-store.ts apps/web/src/board/board-store.test.ts
git commit -m "feat(board): board store + pure column logic"
```

---

## Task 6: `/board` route + sidebar entry + dnd-kit dependency

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/board/board-page.tsx` (placeholder for this task)
- Create: `apps/web/src/routes/board.tsx`
- Modify: `apps/web/src/components/sidebar.tsx`

**Interfaces:**
- Produces: a reachable `/board` route rendering a placeholder `<BoardPage />`; a "Board" sidebar item.

- [ ] **Step 1: Add dnd-kit (pinned).** In `apps/web/package.json`, add to `dependencies` (look up the current versions with `pnpm view @dnd-kit/core version` and `@dnd-kit/sortable version`, pin EXACTLY, no `^`):

```json
		"@dnd-kit/core": "<exact-version>",
		"@dnd-kit/sortable": "<exact-version>",
```

Run: `pnpm install`
Expected: lockfile updated, both packages resolved.

- [ ] **Step 2: Placeholder page.** Create `apps/web/src/board/board-page.tsx`:

```tsx
export function BoardPage() {
	return <div className="p-6">Board</div>;
}
```

- [ ] **Step 3: Route.** Create `apps/web/src/routes/board.tsx` (mirror `apps/web/src/routes/account.tsx`):

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { BoardPage } from "@/board/board-page";

export const Route = createFileRoute("/board")({ component: BoardPage });
```

- [ ] **Step 4: Sidebar item.** In `apps/web/src/components/sidebar.tsx`, add a Board entry to the `SECTIONS` array (use a lucide icon already imported in that file, or import `LayoutDashboard`):

```tsx
	{ kind: "item", item: { to: "/board", label: "Board", icon: LayoutDashboard } },
```

- [ ] **Step 5: Verify it builds + routes.**

Run: `pnpm -F web check-types`
Expected: passes (routeTree.gen.ts regenerates to include `/board`). Commit the regenerated `routeTree.gen.ts`.

- [ ] **Step 6: Lint + commit.**

```bash
pnpm dlx ultracite fix
git add apps/web/package.json apps/web/src/board/board-page.tsx apps/web/src/routes/board.tsx apps/web/src/components/sidebar.tsx apps/web/src/routeTree.gen.ts pnpm-lock.yaml
git commit -m "feat(board): /board route + sidebar entry + dnd-kit"
```

---

## Task 7: `<TaskBoard>` + `<TaskCard>` + `<TaskColumn>` — fan-out render

**Files:**
- Create: `apps/web/src/board/board-client.ts`
- Create: `apps/web/src/board/task-card.tsx`
- Create: `apps/web/src/board/task-column.tsx`
- Create: `apps/web/src/board/task-board.tsx`
- Modify: `apps/web/src/board/board-page.tsx`

**Interfaces:**
- Consumes: `AgentClient.runTools/runTool` (Task 4), `createBoardStore`/`COLUMNS`/pure helpers (Task 5). Obtain the web `agentClient` + a `sessionId` the SAME way `apps/web/src/components/chat/chat-view.tsx` does (read that file; reuse its agent-client construction and session creation).
- Produces: `<TaskBoard agentClient sessionId />` that fans out three `listColumn` reads on mount and fills each column as its result streams in; `parseColumn(result): BoardTask[]`.

- [ ] **Step 1: Board client.** Create `apps/web/src/board/board-client.ts` — thin wrappers translating tool results to `BoardTask[]`:

```ts
import type { AgentClient } from "@jacksonw111/agent-client";
import type { BoardStatus, BoardTask } from "./board-store";

export function parseColumn(result: unknown): BoardTask[] {
	if (!Array.isArray(result)) {
		return [];
	}
	return result.map((row) => ({
		id: String((row as BoardTask).id),
		title: String((row as BoardTask).title),
		description: String((row as BoardTask).description ?? ""),
		status: (row as BoardTask).status,
		position: Number((row as BoardTask).position ?? 0),
	}));
}

export function parseTask(result: unknown): BoardTask {
	const [task] = parseColumn([result]);
	return task;
}

export async function loadColumns(
	client: AgentClient,
	sessionId: string,
	onColumn: (status: BoardStatus, tasks: BoardTask[]) => void
): Promise<void> {
	const calls = (["todo", "in_progress", "done"] as BoardStatus[]).map(
		(status) => ({
			callId: status,
			name: "listColumn",
			args: { status },
		})
	);
	await client.runTools(sessionId, calls, (result) => {
		onColumn(result.callId as BoardStatus, parseColumn(result.result));
	});
}
```

- [ ] **Step 2: TaskCard.** Create `apps/web/src/board/task-card.tsx` (shadcn Card; ≤ 50-line component):

```tsx
import { Card } from "@better-agent/ui/components/card";
import { TrashIcon } from "lucide-react";
import type { BoardTask } from "./board-store";

export function TaskCard({
	task,
	onOpen,
	onDelete,
}: {
	task: BoardTask;
	onOpen: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<Card className="group flex items-start justify-between gap-2 p-3 text-sm">
			<button
				className="flex-1 text-left"
				onClick={() => onOpen(task.id)}
				type="button"
			>
				{task.title}
			</button>
			<button
				aria-label="Delete task"
				className="text-muted-foreground opacity-0 transition group-hover:opacity-100"
				onClick={() => onDelete(task.id)}
				type="button"
			>
				<TrashIcon className="size-4" />
			</button>
		</Card>
	);
}
```

- [ ] **Step 3: TaskColumn.** Create `apps/web/src/board/task-column.tsx` — header + skeleton-until-loaded + cards. (Drag wiring is added in Task 8; this task renders static cards + a per-column loading skeleton.)

```tsx
import { Badge } from "@better-agent/ui/components/badge";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import type { BoardStatus, BoardTask } from "./board-store";
import { TaskCard } from "./task-card";

const SKELETON_ROWS = [0, 1];

export function TaskColumn({
	label,
	status,
	tasks,
	loaded,
	onOpen,
	onDelete,
}: {
	label: string;
	status: BoardStatus;
	tasks: BoardTask[];
	loaded: boolean;
	onOpen: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg bg-muted/40 p-3">
			<div className="flex items-center justify-between">
				<span className="font-medium text-sm">{label}</span>
				<Badge variant="secondary">{tasks.length}</Badge>
			</div>
			<div className="flex flex-col gap-2 overflow-y-auto" data-status={status}>
				{loaded
					? tasks.map((task) => (
							<TaskCard
								key={task.id}
								onDelete={onDelete}
								onOpen={onOpen}
								task={task}
							/>
						))
					: SKELETON_ROWS.map((row) => (
							<Skeleton className="h-12 w-full" key={row} />
						))}
			</div>
		</div>
	);
}
```

- [ ] **Step 4: TaskBoard.** Create `apps/web/src/board/task-board.tsx` — orchestration: store, fan-out load, loaded-set, grouping. (≤ 50-line functions; extract handlers as needed.)

```tsx
import type { AgentClient } from "@jacksonw111/agent-client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadColumns } from "./board-client";
import {
	type BoardStatus,
	COLUMNS,
	createBoardStore,
	groupByColumn,
} from "./board-store";
import { TaskColumn } from "./task-column";

export function TaskBoard({
	agentClient,
	sessionId,
	onOpenTask,
}: {
	agentClient: AgentClient;
	sessionId: string;
	onOpenTask: (id: string) => void;
}) {
	const storeRef = useRef(createBoardStore());
	const store = storeRef.current;
	const tasks = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const [loaded, setLoaded] = useState<Set<BoardStatus>>(new Set());

	useEffect(() => {
		let active = true;
		loadColumns(agentClient, sessionId, (status, columnTasks) => {
			if (!active) {
				return;
			}
			store.setColumn(status, columnTasks);
			setLoaded((prev) => new Set(prev).add(status));
		});
		return () => {
			active = false;
		};
	}, [agentClient, sessionId, store]);

	const groups = groupByColumn(tasks);
	const onDelete = (id: string) => {
		store.removeLocal(id);
		agentClient.runTool(sessionId, "deleteTask", { id }).catch(() => undefined);
	};

	return (
		<div className="flex h-full gap-4 overflow-x-auto p-4">
			{COLUMNS.map((column) => (
				<TaskColumn
					key={column.status}
					label={column.label}
					loaded={loaded.has(column.status)}
					onDelete={onDelete}
					onOpen={onOpenTask}
					status={column.status}
					tasks={groups[column.status]}
				/>
			))}
		</div>
	);
}
```

- [ ] **Step 5: Wire the page.** Update `apps/web/src/board/board-page.tsx` to construct the agent client + session (reuse chat-view's approach) and render `<TaskBoard>`; manage the open-task id with `useState` (the modal arrives in Task 9 — for now `onOpenTask` can set state that is unused, or log). Keep it minimal and type-correct.

- [ ] **Step 6: Verify build.**

Run: `pnpm -F web check-types`
Expected: passes.

- [ ] **Step 7: Lint + commit.**

```bash
pnpm dlx ultracite fix
git add apps/web/src/board/board-client.ts apps/web/src/board/task-card.tsx apps/web/src/board/task-column.tsx apps/web/src/board/task-board.tsx apps/web/src/board/board-page.tsx
git commit -m "feat(board): TaskBoard fan-out render of columns"
```

> No unit test in this task (UI composition). Pure logic was tested in Task 5; `parseColumn` is exercised by the Task 8 reconcile flow. If the reviewer wants `parseColumn` covered, add a small test in Task 8.

---

## Task 8: Drag-drop + create + optimistic persistence

**Files:**
- Modify: `apps/web/src/board/task-board.tsx`
- Modify: `apps/web/src/board/task-column.tsx`
- Modify: `apps/web/src/board/task-card.tsx`
- Create: `apps/web/src/board/board-client.test.ts`

**Interfaces:**
- Consumes: `@dnd-kit/core` (`DndContext`, `useDroppable`), `@dnd-kit/sortable` (`SortableContext`, `useSortable`), `midpoint`/`nextPosition` (Task 5), `parseTask` (Task 7).
- Produces: cross-column drag → optimistic `applyMove` + `runTool("moveTask")`; per-column "Add" → optimistic temp card + `runTool("createTask")` then `replaceLocal` with the server task.

- [ ] **Step 1: Make TaskCard sortable.** Wrap `TaskCard` body with `useSortable({ id: task.id })`, applying `attributes`, `listeners`, `setNodeRef`, and `transform`/`transition` styles to the Card. Keep the delete button's `onClick` calling `stopPropagation` so a click doesn't start a drag.

- [ ] **Step 2: Column droppable + Add affordance.** In `TaskColumn`, wrap the card list in `SortableContext` (`items={tasks.map((t) => t.id)}`) and a `useDroppable({ id: status })` region. Add a shadcn `Button variant="ghost"` "+ Add" at the column bottom that calls an `onCreate(status)` prop.

- [ ] **Step 3: DnD + create handlers in TaskBoard.** Add `DndContext` around the columns with `onDragEnd`. On drop: determine destination `status` (from `over`), compute the new `position` via `midpoint` against the destination column's neighbors, call `store.applyMove(id, status, position)` optimistically, then `agentClient.runTool(sessionId, "moveTask", { id, status, position })`; on failure revert (reload that column) + `toast`. Add `onCreate(status)`:

```tsx
	const onCreate = (status: BoardStatus) => {
		const tempId = `temp-${crypto.randomUUID()}`;
		const title = "New task";
		store.addLocal({ id: tempId, title, description: "", status, position: nextPosition(groups[status]) });
		agentClient
			.runTool(sessionId, "createTask", { title, status })
			.then((result) => store.replaceLocal(tempId, parseTask(result)))
			.catch(() => {
				store.removeLocal(tempId);
				toast.error("Could not create task");
			});
	};
```

Use `toast` from `sonner` (web already wires `<Toaster />`; import `toast` from the same place chat-view does). Extract `onDragEnd` into a named helper if the component callback exceeds 50 lines.

- [ ] **Step 4: Write a small failing test for the client mapping.** Create `apps/web/src/board/board-client.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { loadColumns, parseColumn, parseTask } from "./board-client";

it("parseColumn maps rows to BoardTask and ignores non-arrays", () => {
	expect(parseColumn([{ id: 1, title: "a", status: "todo", position: 2 }])).toEqual([
		{ id: "1", title: "a", description: "", status: "todo", position: 2 },
	]);
	expect(parseColumn({ nope: true })).toEqual([]);
});

it("parseTask maps a single row", () => {
	expect(parseTask({ id: "z", title: "t", status: "done", position: 1 })).toMatchObject({
		id: "z",
		status: "done",
	});
});

it("loadColumns fires three listColumn calls and routes results by callId", async () => {
	const runTools = vi.fn((_s, _calls, onResult) => {
		onResult({ callId: "done", name: "listColumn", result: [{ id: "d", title: "x", status: "done", position: 1 }], isError: false });
		return Promise.resolve();
	});
	const seen: string[] = [];
	await loadColumns({ runTools } as never, "s1", (status) => seen.push(status));
	expect(runTools).toHaveBeenCalledTimes(1);
	expect(seen).toContain("done");
});
```

- [ ] **Step 5: Run the test.**

Run: `pnpm -F web test src/board/board-client.test.ts`
Expected: passing.

- [ ] **Step 6: Verify build + lint + commit.**

```bash
pnpm -F web check-types
pnpm dlx ultracite fix
git add apps/web/src/board/task-board.tsx apps/web/src/board/task-column.tsx apps/web/src/board/task-card.tsx apps/web/src/board/board-client.test.ts
git commit -m "feat(board): drag-drop + create with optimistic persistence"
```

---

## Task 9: `<TaskModal>` — detail + editable description

**Files:**
- Create: `apps/web/src/board/task-modal.tsx`
- Modify: `apps/web/src/board/task-board.tsx` (open from card → modal state)
- Modify: `apps/web/src/board/board-page.tsx`

**Interfaces:**
- Consumes: shadcn `Dialog`, `Textarea`, `Button`, `Badge`; `runTool("getTask")`, `runTool("updateTask")`.
- Produces: `<TaskModal agentClient sessionId taskId open onOpenChange onSaved />` that loads the task via `getTask` when opened and saves the description via `updateTask`.

- [ ] **Step 1: Modal component.** Create `apps/web/src/board/task-modal.tsx` using shadcn `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`, a `Textarea` for the description, a `Button` to save. On open, `runTool(sessionId, "getTask", { id: taskId })` → populate; on save, `runTool(sessionId, "updateTask", { id, description })` → call `onSaved(parseTask(result))` and close. Split into ≤300-line file / ≤50-line functions; extract a `useTaskDetail(agentClient, sessionId, taskId, open)` hook if needed.

- [ ] **Step 2: Open from board.** In `TaskBoard`, lift `openTaskId` state (or accept it from the page). Clicking a card (`onOpen`) sets the open id; render `<TaskModal>` controlled by that id. On `onSaved`, `store.replaceLocal(task.id, task)`.

- [ ] **Step 3: Verify build.**

Run: `pnpm -F web check-types`
Expected: passes. (No new unit test — covered by reconcile logic from Task 5/8. Add a test only if the reviewer flags the hook's state transitions.)

- [ ] **Step 4: Lint + commit.**

```bash
pnpm dlx ultracite fix
git add apps/web/src/board/task-modal.tsx apps/web/src/board/task-board.tsx apps/web/src/board/board-page.tsx
git commit -m "feat(board): task detail modal with editable description"
```

---

## Task 10: Floating `<BoardChat>` + `openTask` client action

**Files:**
- Create: `apps/web/src/board/board-chat.tsx`
- Modify: `apps/web/src/board/board-page.tsx`

**Interfaces:**
- Consumes: `<Conversation>` from `@better-agent/ui/components/chat/conversation`, the existing generative-UI chat config (`apps/web/src/genui/config.ts`), the board's open-task handler.
- Produces: a fixed bottom-right chat launcher (shadcn `Button` + `Dialog`/`Popover`) hosting `<Conversation>` bound to the board's `sessionId`; an `openTask` client action that opens the modal + refreshes the affected column.

- [ ] **Step 1: Floating launcher.** Create `apps/web/src/board/board-chat.tsx`: a fixed `bottom-6 right-6` shadcn `Button` (message icon) that toggles a panel (shadcn `Popover` or `Dialog`) containing `<Conversation sessionId={sessionId} agentClient={agentClient} generativeUI={...} />`. Reuse the SAME `sessionId` the board uses so chat mutations and board reads share the session.

- [ ] **Step 2: openTask action handler.** Extend the generative-UI config's `handlers`/`onAction` (the A2 action routing already built) so an action `{ intent: "openTask", target: "client", payload: { id } }` calls a callback passed from the page → opens `<TaskModal>` for that id AND triggers `loadColumns`-style refresh of the affected column (re-`runTool("listColumn", { status })` for the columns, or just reload all three). Pass the callback down from `board-page.tsx`.

- [ ] **Step 3: Compose the page.** In `board-page.tsx`, render `<TaskBoard>`, `<TaskModal>`, and `<BoardChat>` sharing one `agentClient` + `sessionId` + the open-task/refresh handlers.

- [ ] **Step 4: Verify build.**

Run: `pnpm -F web check-types`
Expected: passes.

- [ ] **Step 5: Lint + commit.**

```bash
pnpm dlx ultracite fix
git add apps/web/src/board/board-chat.tsx apps/web/src/board/board-page.tsx
git commit -m "feat(board): floating chat + openTask client action"
```

---

## Task 11: Bind task tools into the user-session model turn

**Files:**
- Modify: `packages/api/src/routers/user-sessions.ts`
- Test: `packages/api/src/routers/user-sessions-toolcalls.test.ts` (add a model-turn case) OR a focused new test.

**Interfaces:**
- Consumes: `buildTaskToolDefs`, `streamUserTurn`'s existing tool-merge.
- Produces: in `streamUserTurn`, the task tools (bound to the session's user) are merged into the agent's tool defs so the model can call `getTask`/`updateTask`/etc. during a chat turn.

- [ ] **Step 1: Merge task tools.** In `streamUserTurn` (`user-sessions.ts`), where it builds `agentToolDefs` / merges remote+composio+builtin tools, also build `buildTaskToolDefs(context.services.stores.task, userId)` and concat them into the `tools` array passed to `runtime.runTurn`. Ensure name collisions are impossible (task tool names are unique).

- [ ] **Step 2: Test the model can call a task tool.** Add a test that drives a model turn whose mock model emits a tool-call for `createTask`, and assert a `tool-result` flows and the task is created in the in-memory store. Mirror the `HAPPY`/`mockModel` pattern from `user-sessions.test.ts`, but make the mock model stream a `tool-call` chunk for `createTask` then finish. Assert the store received the task.

- [ ] **Step 3: Run the test.**

Run: `pnpm -F @better-agent/api test`
Expected: existing + new tests pass.

- [ ] **Step 4: Lint + commit.**

```bash
pnpm dlx ultracite fix
git add packages/api/src/routers/user-sessions.ts packages/api/src/routers/user-sessions-toolcalls.test.ts
git commit -m "feat(board): bind task tools into the model turn"
```

---

## Task 12: Polish, responsive, deploy

**Files:**
- Modify: board components as needed (empty states, transitions, mobile).

**Interfaces:** none new.

- [ ] **Step 1: Empty states.** Each column with zero tasks (and `loaded === true`) shows a quiet empty hint above the "+ Add" button (muted text, shadcn typography). No raw divs where a ui component fits.

- [ ] **Step 2: Transitions.** Add `animate-in fade-in` (motion-reduce-safe) to cards on first render and to the column fill, consistent with the existing TodoList transitions. Respect `prefers-reduced-motion`.

- [ ] **Step 3: Responsive.** Columns scroll horizontally on narrow screens (`overflow-x-auto`, `min-w-[16rem]` per column). The floating chat panel is full-width on mobile.

- [ ] **Step 4: Full type + lint sweep.**

Run: `pnpm -F web check-types && pnpm dlx ultracite check`
Expected: clean.

- [ ] **Step 5: Run the affected package test suites.**

Run: `pnpm -F @better-agent/db test && pnpm -F @better-agent/agent test && pnpm -F @better-agent/api test && pnpm -F @jacksonw111/agent-client test && pnpm -F web test`
Expected: all green.

- [ ] **Step 6: Commit + push (deploy via GH Action on `dev`).**

```bash
pnpm dlx ultracite fix
git add -A
git commit -m "feat(board): polish, empty states, responsive"
git push origin dev
```

Verify local `HEAD` == remote `dev` HEAD after push. The GitHub Action deploys to the Workers test environment; the user tests there (no local deploy, no auto browser testing).

---

## Self-Review

**Spec coverage:**
- One interface / no REST / no callTool → Tasks 3, 4 (stream union, SDK over the stream). ✅
- Minimal tools, fan-out, stream-as-resolved → Task 2 (`listColumn` + minimal tools), Task 3 (`streamSettled` completion-order), Task 7 (`loadColumns` fan-out, per-column skeleton fill). ✅
- `tasks` table, user-scoped TaskStore → Task 1. ✅
- Board: render-on-enter, drag, create, delete, modal, floating chat, openTask → Tasks 7–10. ✅
- Model can call the same tools → Task 11. ✅
- shadcn-only frontend → enforced in Global Constraints + every component step names ui imports. ✅
- Identity/auth user-scoping → Task 1 (store filters by userId) + Task 3 (`context.authedUser.id` on both paths). ✅

**Type consistency:** `TaskStatus`/`Task` (agent) vs `BoardStatus`/`BoardTask` (web) are intentionally separate (web must not import agent server types); `parseColumn` bridges them. `ToolCallRequest`/`ToolCallResult` are consistent across Task 4 (types) and Task 7/8 (consumers). `tool-result` event gains `name?` in Task 3 and is read in Task 4. `runTool`'s single-call matching is corrected in Task 4 Step 3.

**Placeholder scan:** UI Tasks 7/9/10 describe component composition in prose with named ui imports and the exact tool calls rather than full JSX for every element — acceptable because the data contracts (props, tool names, store calls) are fully specified and the heavy logic (store, client mapping, stream) carries complete code + tests. Implementers must follow the named imports and the shadcn-only constraint.

**Open items for the implementer to confirm from the codebase (not guesses):**
1. `requireUserSession`'s exact signature/return (`user-sessions.ts:70`) — adjust the Task 3 fake `session` store accordingly.
2. The web `agentClient` construction + `sessionId` creation in `apps/web/src/components/chat/chat-view.tsx` — reuse it verbatim in `board-page.tsx` (Task 7).
3. The agent-client package name in `packages/client/package.json` for the `pnpm -F` test filter (Task 4).
4. The exact `toast` import + generative-UI config export path used by chat-view (Tasks 8, 10).
