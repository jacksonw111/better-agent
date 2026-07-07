# Generative UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent return a declarative JSON UI tree that a client renders with its own registered component library, with a testable `/genui` playground in apps/web, layered token-cost safety, and component-level streaming.

**Architecture:** A client registers a component manifest → the SDK derives one recursive JSON Schema used as the model's structured-output schema and a structural validator. The agent produces the tree via the existing `StructuredOutput` tool; its streaming input-arg deltas are surfaced as a new `structured-delta` event so the UI reveals progressively. apps/web is the first consumer: a starter library + mock client tools + a generic renderer.

**Tech Stack:** TypeScript, oRPC, AI SDK (`ai` v6), Zod v4 (`z.toJSONSchema`), React 19, TanStack Router, base-ui, vitest.

**Spec:** `docs/superpowers/specs/2026-06-28-generative-ui-design.md` (and `.zh.md`).

## Global Constraints

- **Branch:** work on `dev`. Never commit to `main`. (Deploy is a GitHub Action on push to `dev`.)
- **No local deploys.** Verify by running tests/typecheck locally; do not run wrangler deploy.
- **Published-SDK purity:** `@jacksonw111/agent-client` must gain **no new runtime dependencies**. `ComponentDef.props` is a JSON Schema object (`Record<string, unknown>`), NOT a Zod schema, so the SDK needs neither `zod` nor a JSON-schema lib. (apps/web authors props with `z.toJSONSchema` on its own side — apps/web already depends on zod.)
- **File-size cap:** every source file ≤ 300 lines (enforced by `scripts/check-file-rules.js`; there is NO override). Split proactively.
- **ESLint gates (block on warning):** `max-lines-per-function` 50, `complexity` 10, `max-params` 4, `no-magic-numbers`. Use object params past 4 args; extract helpers to stay under 50 lines; name constants.
- **Biome/ultracite:** interfaces over type aliases for object shapes (`useConsistentTypeDefinitions`), `T[]` not `Array<T>` (`useConsistentArrayType`), no barrel files (`noBarrelFile`), no namespace/`import *`, no `void` operator — use `.then()/.catch()`. Run `pnpm dlx ultracite fix` before each commit.
- **No new agent core capability** beyond the `structured-delta` event; structured output stays opt-in (`outputSchema` absent on normal chat → no `StructuredOutput` tool → no `structured-delta`).
- **Per-package test command:** `pnpm -F <pkg> test` (vitest). Typecheck: `pnpm -F <pkg> check-types`.

## File Structure

**`@jacksonw111/agent-client` (packages/client):**
- `src/genui/types.ts` — `ComponentDef`, `UINode`, `UIAction`, `GenerativeUI` interfaces (NEW)
- `src/genui/define-components.ts` — `defineComponents()` schema builder + structural `validate` (NEW)
- `src/index.ts` — re-export the genui surface (MODIFY)
- `src/tool-stream.ts` — shared prompt+tool-dispatch generator used by both planes (NEW)
- `src/internal.ts` — both planes use the shared dispatcher; user plane forwards tools (MODIFY)

**`@better-agent/agent` (packages/agent):**
- `src/session/partial-json.ts` — best-effort partial-JSON completer (NEW)
- `src/session/events.ts` — add `structured-delta` to `RunEvent` (MODIFY)
- `src/session/runtime-drain.ts` — surface `StructuredOutput` tool-input deltas (MODIFY)

**`@better-agent/ui` (packages/ui):**
- `src/lib/genui-tree.ts` — pure tree logic (keys, completeness, type lookup) (NEW)
- `src/components/genui/node-view.tsx` — recursive node renderer (NEW)
- `src/components/genui/generative-ui.tsx` — `<GenerativeUI>` entry (NEW)
- `package.json` — add `./components/genui/*` export glob (MODIFY)

**apps/web:**
- `src/genui/manifest.ts` — the starter `ComponentDef[]` (props via `z.toJSONSchema`) (NEW)
- `src/genui/renderers.tsx` — `type → React component` map (NEW)
- `src/genui/tools.ts` — mock data tools (`ClientToolDef[]`) (NEW)
- `src/genui/handlers.ts` — local action handlers + `routeAction` (NEW)
- `src/components/genui/genui-view.tsx` — `<GenerativeUIView>` (stream + partial + action) (NEW)
- `src/routes/genui.tsx` — the playground route (NEW)

---

## Task 1: SDK genui contract — types, schema derivation, validate

**Files:**
- Create: `packages/client/src/genui/types.ts`
- Create: `packages/client/src/genui/define-components.ts`
- Create: `packages/client/src/genui/define-components.test.ts`
- Modify: `packages/client/src/index.ts`

**Interfaces:**
- Produces:
  - `interface UIAction { intent: string; target: "agent" | "client"; payload?: unknown }`
  - `interface UINode { id: string; type: string; props: Record<string, unknown>; children?: UINode[]; action?: UIAction }`
  - `interface ComponentDef { type: string; description: string; props: Record<string, unknown>; children?: boolean; actions?: string[] }`
  - `interface GenerativeUI { outputSchema: Record<string, unknown>; types: string[]; validate(structured: unknown): UINode | null }`
  - `function defineComponents(defs: ComponentDef[]): GenerativeUI`

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/genui/define-components.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type ComponentDef, defineComponents } from "./define-components";

const DEFS: ComponentDef[] = [
	{
		type: "Card",
		description: "A titled container.",
		props: { type: "object", properties: { title: { type: "string" } } },
		children: true,
	},
	{
		type: "Button",
		description: "A clickable button.",
		props: { type: "object", properties: { label: { type: "string" } } },
		actions: ["press"],
	},
];

describe("defineComponents", () => {
	it("derives an object schema wrapping a recursive UINode union", () => {
		const ui = defineComponents(DEFS);
		const schema = ui.outputSchema as Record<string, any>;
		expect(schema.type).toBe("object");
		expect(schema.properties.root.$ref).toBe("#/$defs/UINode");
		expect(schema.required).toContain("root");
		const branches = schema.$defs.UINode.anyOf as Record<string, any>[];
		expect(branches).toHaveLength(2);
		const card = branches.find((b) => b.properties.type.const === "Card");
		expect(card.description).toBe("A titled container.");
		expect(card.properties.children.items.$ref).toBe("#/$defs/UINode");
		const button = branches.find((b) => b.properties.type.const === "Button");
		expect(button.properties.children).toBeUndefined();
		expect(button.properties.action.properties.intent.enum).toEqual(["press"]);
	});

	it("validate narrows a well-formed tree and reads .root", () => {
		const ui = defineComponents(DEFS);
		const tree = ui.validate({
			root: { id: "a", type: "Card", props: { title: "Hi" }, children: [] },
		});
		expect(tree?.type).toBe("Card");
	});

	it("validate rejects unknown types and malformed nodes", () => {
		const ui = defineComponents(DEFS);
		expect(ui.validate({ root: { id: "a", type: "Nope", props: {} } })).toBeNull();
		expect(ui.validate({ root: { type: "Card", props: {} } })).toBeNull();
		expect(ui.validate(null)).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @jacksonw111/agent-client test`
Expected: FAIL — `Cannot find module './define-components'`.

- [ ] **Step 3: Write the types**

Create `packages/client/src/genui/types.ts`:

```ts
/** An action a rendered component may emit back to the host. */
export interface UIAction {
	intent: string;
	payload?: unknown;
	target: "agent" | "client";
}

/** A node in the agent-produced UI tree (structured output). */
export interface UINode {
	action?: UIAction;
	children?: UINode[];
	id: string;
	props: Record<string, unknown>;
	type: string;
}

/** One registered component: the client's "contract language". `props` is a
 * JSON Schema object (author it however you like, e.g. `z.toJSONSchema(...)`). */
export interface ComponentDef {
	actions?: string[];
	children?: boolean;
	description: string;
	props: Record<string, unknown>;
	type: string;
}

/** The compiled library: schema for the model + a structural validator. */
export interface GenerativeUI {
	outputSchema: Record<string, unknown>;
	types: string[];
	validate(structured: unknown): UINode | null;
}
```

- [ ] **Step 4: Write the schema builder + validator**

Create `packages/client/src/genui/define-components.ts`:

```ts
import type {
	ComponentDef,
	GenerativeUI,
	UINode,
} from "./types";

export type { ComponentDef, GenerativeUI, UINode, UIAction } from "./types";

const NODE_REF = "#/$defs/UINode";

function actionSchema(actions: string[]): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			intent: { type: "string", enum: actions },
			target: { type: "string", enum: ["agent", "client"] },
			payload: {},
		},
		required: ["intent", "target"],
		additionalProperties: false,
	};
}

function branchSchema(def: ComponentDef): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		id: { type: "string" },
		type: { const: def.type },
		props: def.props,
	};
	if (def.children) {
		properties.children = { type: "array", items: { $ref: NODE_REF } };
	}
	if (def.actions && def.actions.length > 0) {
		properties.action = actionSchema(def.actions);
	}
	return {
		type: "object",
		description: def.description,
		properties,
		required: ["id", "type", "props"],
		additionalProperties: false,
	};
}

function buildSchema(defs: ComponentDef[]): Record<string, unknown> {
	return {
		type: "object",
		properties: { root: { $ref: NODE_REF } },
		required: ["root"],
		additionalProperties: false,
		$defs: { UINode: { anyOf: defs.map(branchSchema) } },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNode(value: unknown, types: Set<string>): UINode | null {
	if (!isRecord(value)) {
		return null;
	}
	const { id, type, props, children } = value;
	if (typeof id !== "string" || typeof type !== "string" || !types.has(type)) {
		return null;
	}
	if (!isRecord(props)) {
		return null;
	}
	if (children !== undefined) {
		if (!Array.isArray(children)) {
			return null;
		}
		for (const child of children) {
			if (validateNode(child, types) === null) {
				return null;
			}
		}
	}
	return value as UINode;
}

/** Compile a component manifest into a model schema + a structural validator. */
export function defineComponents(defs: ComponentDef[]): GenerativeUI {
	const types = new Set(defs.map((d) => d.type));
	const outputSchema = buildSchema(defs);
	return {
		outputSchema,
		types: [...types],
		validate(structured) {
			if (!isRecord(structured)) {
				return null;
			}
			return validateNode(structured.root, types);
		},
	};
}
```

- [ ] **Step 5: Export from the package root**

In `packages/client/src/index.ts`, add (near the other exports):

```ts
export {
	type ComponentDef,
	defineComponents,
	type GenerativeUI,
	type UIAction,
	type UINode,
} from "./genui/define-components";
```

- [ ] **Step 6: Run tests + typecheck + lint**

Run: `pnpm -F @jacksonw111/agent-client test && pnpm -F @jacksonw111/agent-client check-types && pnpm dlx ultracite check packages/client/src/genui`
Expected: tests PASS, typecheck clean, lint clean.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/genui packages/client/src/index.ts
git commit -m "feat(client): defineComponents — derive UI schema + validator"
```

---

## Task 2: SDK user-plane client dispatches client tools

The user-session plane (what apps/web uses) accepts remote tools server-side but the SDK's `createUserSessionClientFrom` neither forwards tool defs nor dispatches `tool-call` events. Extract the agent-plane dispatch loop into a shared generator and use it on both planes.

**Files:**
- Create: `packages/client/src/tool-stream.ts`
- Modify: `packages/client/src/internal.ts:111-147` (agent-plane `streamTurn`), `:222-236` (user-plane stream)
- Modify: `packages/client/src/index.test.ts`

**Interfaces:**
- Consumes: `dispatchToolCall` and `stripToolDefs` (already in `internal.ts`), `RunEvent`, `RunOptions` (from `./types`).
- Produces: `streamPromptWithTools(args): AsyncGenerator<RunEvent>` where
  ```ts
  interface PromptToolStreamArgs {
    prompt(input: { sessionId: string; text: string; tools?: StrippedTool[]; outputSchema?: Record<string, unknown>; attachmentIds?: string[] }, opts: { signal?: AbortSignal }): Promise<AsyncIterable<RunEvent>>;
    submit(input: { sessionId: string; callId: string; result: string; isError: boolean }): Promise<unknown>;
    sessionId: string;
    text: string;
    options: RunOptions | undefined;
  }
  ```

- [ ] **Step 1: Write the failing test**

Add to `packages/client/src/index.test.ts` (the existing stub harness supports `prompt`/`submitToolResult`; extend the user-session stub to record forwarded tools). Append:

```ts
import { describe as describe2, expect as expect2, it as it2 } from "vitest";

it2("user-session stream forwards tool defs and dispatches tool-calls", async () => {
	const calls = makeCalls();
	const events: RunEvent[] = [
		{ type: "tool-call", callId: "c1", toolName: "echo", args: { x: 1 } },
		{ type: "done", usage: null, finishReason: "stop" },
	];
	const userSessions = makeUserSessionsStub(calls, events); // see Step 3
	const client = { userSessions } as never;
	const sdk = createUserSessionClientFrom(client, "agent-1");
	const tool: ClientToolDef = {
		name: "echo",
		description: "echo",
		parameters: {},
		execute: (a) => Promise.resolve(JSON.stringify(a)),
	};
	const seen: string[] = [];
	for await (const ev of sdk.stream("hi", { sessionId: "s1", tools: [tool] })) {
		seen.push(ev.type);
	}
	expect2(calls.prompt[0]?.tools).toEqual([
		{ name: "echo", description: "echo", parameters: {} },
	]);
	expect2(calls.submitToolResult[0]?.result).toBe(JSON.stringify({ x: 1 }));
	expect2(seen).toContain("tool-call");
});
```

Add a `makeUserSessionsStub` next to `makeSessionsStub` (mirror it, but `create` takes `{ agentId }` and returns `{ id: SESSION_ID }`; `prompt` records `tools`; include `submitToolResult` pushing to `calls.submitToolResult`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @jacksonw111/agent-client test`
Expected: FAIL — user-plane stream does not forward `tools` / does not call `submitToolResult`.

- [ ] **Step 3: Extract the shared dispatcher**

Create `packages/client/src/tool-stream.ts`:

```ts
import { dispatchToolCall } from "./internal";
import type { RunEvent, RunOptions } from "./types";

interface StrippedTool {
	description: string;
	name: string;
	parameters: Record<string, unknown>;
}

interface PromptInput {
	attachmentIds?: string[];
	outputSchema?: Record<string, unknown>;
	sessionId: string;
	text: string;
	tools?: StrippedTool[];
}

export interface PromptToolStreamArgs {
	options: RunOptions | undefined;
	prompt(
		input: PromptInput,
		opts: { signal?: AbortSignal }
	): Promise<AsyncIterable<RunEvent>>;
	sessionId: string;
	submit(input: {
		callId: string;
		isError: boolean;
		result: string;
		sessionId: string;
	}): Promise<unknown>;
	text: string;
}

function strip(tools: RunOptions["tools"]): StrippedTool[] | undefined {
	return tools?.map(({ name, description, parameters }) => ({
		name,
		description,
		parameters,
	}));
}

/** Stream a prompt, dispatching local tool calls and submitting their results. */
export async function* streamPromptWithTools(
	args: PromptToolStreamArgs
): AsyncGenerator<RunEvent> {
	const { options, sessionId } = args;
	const events = await args.prompt(
		{
			sessionId,
			text: args.text,
			tools: strip(options?.tools),
			outputSchema: options?.outputSchema,
			attachmentIds: options?.attachmentIds,
		},
		{ signal: options?.signal }
	);
	const dispatches: Promise<void>[] = [];
	for await (const event of events) {
		yield event;
		if (event.type === "tool-call" && options?.tools) {
			const tools = options.tools;
			dispatches.push(
				dispatchToolCall(tools, event, (r) =>
					args
						.submit({
							sessionId,
							callId: r.callId,
							result: r.result,
							isError: r.isError,
						})
						.then(() => undefined)
				)
			);
		}
	}
	await Promise.all(dispatches);
}
```

- [ ] **Step 4: Use the shared dispatcher in both planes**

In `packages/client/src/internal.ts`:
1. Add import: `import { streamPromptWithTools } from "./tool-stream";`
2. Replace the body of `streamTurn` (agent plane) with a call to `streamPromptWithTools`, binding `prompt: (i, o) => client.sessions.prompt(i, o)` and `submit: (i) => client.sessions.submitToolResult(i)`. (Keep `streamTurn`'s signature; delete the now-duplicated dispatch loop and `stripToolDefs` usage there.)
3. In `createUserSessionClientFrom`'s `stream`, replace the manual `client.userSessions.prompt(...)` loop with:

```ts
async *stream(text, options) {
	const sessionId = await ensureSession(options?.sessionId);
	yield* streamPromptWithTools({
		sessionId,
		text,
		options,
		prompt: (input, opts) => client.userSessions.prompt(input, opts),
		submit: (input) => client.userSessions.submitToolResult(input),
	});
},
```

Note: `stripToolDefs` may become unused in `internal.ts`; remove it if so (lint forbids unused).

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -F @jacksonw111/agent-client test && pnpm -F @jacksonw111/agent-client check-types`
Expected: PASS (both the new test and the existing agent-plane tool tests).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/tool-stream.ts packages/client/src/internal.ts packages/client/src/index.test.ts
git commit -m "feat(client): dispatch client tools on the user-session plane"
```

---

## Task 3: Partial-JSON completer (agent)

**Files:**
- Create: `packages/agent/src/session/partial-json.ts`
- Create: `packages/agent/src/session/partial-json.test.ts`

**Interfaces:**
- Produces: `function completePartialJson(buffer: string): unknown | undefined` — returns the best-available parse of a possibly-truncated JSON string, or `undefined` if nothing usable.

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/session/partial-json.test.ts`:

```ts
import { expect, it } from "vitest";
import { completePartialJson } from "./partial-json";

it("parses already-complete JSON", () => {
	expect(completePartialJson('{"a":1}')).toEqual({ a: 1 });
});

it("completes an unterminated string", () => {
	expect(completePartialJson('{"a":"hi')).toEqual({ a: "hi" });
});

it("completes nested open object and array", () => {
	expect(completePartialJson('{"root":{"children":[{"id":"x"')).toEqual({
		root: { children: [{ id: "x" }] },
	});
});

it("drops a dangling key with no value", () => {
	expect(completePartialJson('{"a":1,"b"')).toEqual({ a: 1 });
});

it("returns undefined for unusable input", () => {
	expect(completePartialJson("")).toBeUndefined();
	expect(completePartialJson("not json")).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @better-agent/agent test partial-json`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the completer**

Create `packages/agent/src/session/partial-json.ts`:

```ts
interface ScanState {
	inString: boolean;
	escaped: boolean;
	stack: string[]; // "}" or "]" closers, innermost last
}

function scan(buffer: string): ScanState {
	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	for (const ch of buffer) {
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === "{") {
			stack.push("}");
		} else if (ch === "[") {
			stack.push("]");
		} else if (ch === "}" || ch === "]") {
			stack.pop();
		}
	}
	return { inString, escaped, stack };
}

// Trim a trailing fragment that can't be closed into valid JSON: an open key
// with no value (…,"b" or {"b"), a dangling colon, or a trailing comma.
function trimDangling(text: string): string {
	let end = text.length;
	while (end > 0 && /\s/.test(text[end - 1] as string)) {
		end--;
	}
	let s = text.slice(0, end);
	if (s.endsWith(",") || s.endsWith(":")) {
		return s.slice(0, -1);
	}
	// A trailing complete string that sits where a key would be (no following colon).
	const keyOnly = /(?:[{,])\s*"(?:[^"\\]|\\.)*"$/;
	if (keyOnly.test(s)) {
		s = s.replace(/\s*"(?:[^"\\]|\\.)*"$/, "");
		return s.endsWith(",") ? s.slice(0, -1) : s;
	}
	return s;
}

function close(buffer: string, state: ScanState): string {
	let s = buffer;
	if (state.inString) {
		s += state.escaped ? '\\"' : '"';
	}
	s = trimDangling(s);
	const rescanned = scan(s);
	let out = s;
	for (let i = rescanned.stack.length - 1; i >= 0; i--) {
		out += rescanned.stack[i];
	}
	return out;
}

/** Best-effort parse of a possibly-truncated JSON buffer. */
export function completePartialJson(buffer: string): unknown | undefined {
	const trimmed = buffer.trim();
	if (trimmed === "") {
		return;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		// fall through to completion
	}
	try {
		return JSON.parse(close(trimmed, scan(trimmed)));
	} catch {
		return;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @better-agent/agent test partial-json`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint + commit**

```bash
pnpm dlx ultracite fix packages/agent/src/session/partial-json.ts
git add packages/agent/src/session/partial-json.ts packages/agent/src/session/partial-json.test.ts
git commit -m "feat(agent): best-effort partial-JSON completer"
```

---

## Task 4: `structured-delta` event + drainStream surfacing

**Files:**
- Modify: `packages/agent/src/session/events.ts:4-18`
- Modify: `packages/agent/src/session/runtime-drain.ts`
- Create: `packages/agent/src/session/runtime-drain.test.ts`

**Interfaces:**
- Consumes: `completePartialJson` (Task 3), `STRUCTURED_OUTPUT_TOOL_NAME` (existing import in runtime-drain).
- Produces: `RunEvent` variant `{ type: "structured-delta"; partial: unknown }`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/session/runtime-drain.test.ts`:

```ts
import { expect, it } from "vitest";
import { drainStream } from "./runtime-drain";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "./structured-output";

function fakeBufs() {
	const noop = () => Promise.resolve();
	return {
		text: { append: noop, finishStep: noop },
		reasoning: { append: noop, finishStep: noop },
	} as never;
}

function fakeCtx() {
	return {
		agentId: "a",
		assistantId: "m",
		sessionId: "s",
		toolDefs: [],
		messageStore: { appendPart: () => Promise.resolve() },
	} as never;
}

async function* chunks(items: unknown[]) {
	for (const c of items) {
		yield c;
	}
}

async function collect(items: unknown[]) {
	const out: { type: string; partial?: unknown }[] = [];
	const state = {} as never;
	const result = { fullStream: chunks(items) } as never;
	for await (const ev of drainStream(result, fakeBufs(), state, fakeCtx())) {
		out.push(ev as never);
	}
	return out;
}

it("surfaces growing structured-delta partials for StructuredOutput", async () => {
	const events = await collect([
		{ type: "tool-input-start", toolCallId: "c1", toolName: STRUCTURED_OUTPUT_TOOL_NAME },
		{ type: "tool-input-delta", toolCallId: "c1", inputTextDelta: '{"root":{"id":"x"' },
		{ type: "tool-input-delta", toolCallId: "c1", inputTextDelta: ',"type":"Card"}}' },
	]);
	const deltas = events.filter((e) => e.type === "structured-delta");
	expect(deltas).toHaveLength(2);
	expect(deltas[1]?.partial).toEqual({ root: { id: "x", type: "Card" } });
});

it("ignores tool-input deltas from other tools", async () => {
	const events = await collect([
		{ type: "tool-input-start", toolCallId: "c2", toolName: "echo" },
		{ type: "tool-input-delta", toolCallId: "c2", inputTextDelta: '{"x":1}' },
	]);
	expect(events.filter((e) => e.type === "structured-delta")).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @better-agent/agent test runtime-drain`
Expected: FAIL — no `structured-delta` events emitted.

- [ ] **Step 3: Add the event variant**

In `packages/agent/src/session/events.ts`, add to the `RunEvent` union (after the `tool-result` line):

```ts
	| { type: "structured-delta"; partial: unknown }
```

- [ ] **Step 4: Surface the deltas in drainStream**

In `packages/agent/src/session/runtime-drain.ts`:
1. Add import: `import { completePartialJson } from "./partial-json";`
2. Add a small helper above `drainStream`:

```ts
interface StructuredBuf {
	callId: string | null;
	text: string;
}

function trackStructuredStart(
	chunk: { type: string; toolCallId?: string; toolName?: string },
	buf: StructuredBuf
): void {
	if (
		chunk.type === "tool-input-start" &&
		chunk.toolName === STRUCTURED_OUTPUT_TOOL_NAME
	) {
		buf.callId = chunk.toolCallId ?? null;
	}
}

function structuredDelta(
	chunk: { type: string; toolCallId?: string; inputTextDelta?: string },
	buf: StructuredBuf
): { type: "structured-delta"; partial: unknown } | null {
	if (
		chunk.type !== "tool-input-delta" ||
		buf.callId === null ||
		chunk.toolCallId !== buf.callId
	) {
		return null;
	}
	buf.text += chunk.inputTextDelta ?? "";
	const partial = completePartialJson(buf.text);
	return partial === undefined ? null : { type: "structured-delta", partial };
}
```

3. In `drainStream`, declare `const structured: StructuredBuf = { callId: null, text: "" };` before the loop, and inside the loop add these two checks at the TOP of the body (before the existing `if (chunk.type === "text-delta")` chain), operating on `chunk as Record<string, unknown>`:

```ts
trackStructuredStart(chunk as never, structured);
const delta = structuredDelta(chunk as never, structured);
if (delta) {
	yield delta;
	continue;
}
```

Use a `for await ... of` with `continue` — the existing chain stays as the `else`-equivalent. (If the existing loop is an `if/else if` chain without `continue`, wrap the existing chain in `else {}` of an `if (delta) {...}`, or convert to early-`continue` as shown. Keep `drainStream` ≤ 50 lines by keeping the new logic in the two helpers above.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F @better-agent/agent test runtime-drain`
Expected: PASS (2 tests).

- [ ] **Step 6: Full agent suite + typecheck (regression: normal streaming unaffected)**

Run: `pnpm -F @better-agent/agent test && pnpm -F @better-agent/agent check-types`
Expected: PASS — existing stream/structured tests still green (the new branch only fires on `tool-input-*` chunks, previously ignored).

- [ ] **Step 7: Lint + commit**

```bash
pnpm dlx ultracite fix packages/agent/src/session/runtime-drain.ts packages/agent/src/session/events.ts
git add packages/agent/src/session/events.ts packages/agent/src/session/runtime-drain.ts packages/agent/src/session/runtime-drain.test.ts
git commit -m "feat(agent): surface StructuredOutput tool-input as structured-delta events"
```

---

## Task 5: Renderer tree logic (ui, pure)

**Files:**
- Create: `packages/ui/src/lib/genui-tree.ts`
- Create: `packages/ui/src/lib/genui-tree.test.ts`

**Interfaces:**
- Consumes: `UINode` (from `@jacksonw111/agent-client`).
- Produces:
  - `function readRoot(tree: unknown): unknown` — returns `tree.root` if present, else `tree`.
  - `function asNode(value: unknown): PartialNode | null` — structural shape `{ id?; type?; props?; children?; action? }`.
  - `function nodeComplete(value: unknown): boolean` — has string `id` and string `type`.
  - `interface PartialNode { action?: unknown; children?: unknown[]; id?: string; props?: Record<string, unknown>; type?: string }`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/lib/genui-tree.test.ts`:

```ts
import { expect, it } from "vitest";
import { asNode, nodeComplete, readRoot } from "./genui-tree";

it("reads the root wrapper or passes through", () => {
	expect(readRoot({ root: { id: "a" } })).toEqual({ id: "a" });
	expect(readRoot({ id: "b" })).toEqual({ id: "b" });
	expect(readRoot(null)).toBeNull();
});

it("treats a node as complete only with string id and type", () => {
	expect(nodeComplete({ id: "a", type: "Card" })).toBe(true);
	expect(nodeComplete({ id: "a" })).toBe(false);
	expect(nodeComplete("x")).toBe(false);
});

it("asNode returns a partial node or null", () => {
	expect(asNode({ type: "Card" })?.type).toBe("Card");
	expect(asNode(42)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @better-agent/ui test genui-tree`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/ui/src/lib/genui-tree.ts`:

```ts
export interface PartialNode {
	action?: unknown;
	children?: unknown[];
	id?: string;
	props?: Record<string, unknown>;
	type?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unwrap the `{ root }` envelope from structured output (partial or final). */
export function readRoot(tree: unknown): unknown {
	if (isRecord(tree) && "root" in tree) {
		return tree.root;
	}
	return tree;
}

/** Coerce an unknown (possibly half-streamed) value into a partial node. */
export function asNode(value: unknown): PartialNode | null {
	if (!isRecord(value)) {
		return null;
	}
	return value as PartialNode;
}

/** A node is renderable (not a skeleton) once it has a stable id and type. */
export function nodeComplete(value: unknown): boolean {
	const node = asNode(value);
	return typeof node?.id === "string" && typeof node?.type === "string";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @better-agent/ui test genui-tree`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/genui-tree.ts packages/ui/src/lib/genui-tree.test.ts
git commit -m "feat(ui): pure tree logic for the generative-UI renderer"
```

---

## Task 6: `<GenerativeUI>` renderer (ui, React)

**Files:**
- Create: `packages/ui/src/components/genui/node-view.tsx`
- Create: `packages/ui/src/components/genui/generative-ui.tsx`
- Modify: `packages/ui/package.json` (exports)

**Interfaces:**
- Consumes: `readRoot`, `asNode`, `nodeComplete`, `PartialNode` (Task 5); `UIAction`, `UINode` (from `@jacksonw111/agent-client`).
- Produces:
  - `interface NodeProps { node: UINode; onAction: (a: UIAction) => void; renderChildren: (children?: UINode[]) => ReactNode }`
  - `interface GenerativeUIProps { tree: unknown; renderers: Record<string, ComponentType<NodeProps>>; onAction: (a: UIAction) => void }`
  - `function GenerativeUI(props: GenerativeUIProps): ReactNode`

- [ ] **Step 1: Add the exports glob**

In `packages/ui/package.json`, add to `exports` (after the `./components/chat/*` line):

```json
		"./components/genui/*": "./src/components/genui/*.tsx",
```

- [ ] **Step 2: Write the recursive node view**

Create `packages/ui/src/components/genui/node-view.tsx`:

```tsx
import type { UIAction, UINode } from "@jacksonw111/agent-client";
import type { ComponentType, ReactNode } from "react";
import { asNode, nodeComplete } from "@better-agent/ui/lib/genui-tree";

export interface NodeProps {
	node: UINode;
	onAction: (action: UIAction) => void;
	renderChildren: (children?: UINode[]) => ReactNode;
}

interface NodeViewProps {
	value: unknown;
	renderers: Record<string, ComponentType<NodeProps>>;
	onAction: (action: UIAction) => void;
}

function Skeleton() {
	return <div className="h-6 w-32 animate-pulse rounded bg-muted" />;
}

function Unknown({ type }: { type: string }) {
	return (
		<div className="rounded border border-dashed px-2 py-1 text-muted-foreground text-xs">
			Unsupported component: {type}
		</div>
	);
}

export function NodeView({ value, renderers, onAction }: NodeViewProps) {
	if (!nodeComplete(value)) {
		return <Skeleton />;
	}
	const node = asNode(value) as UINode;
	const Renderer = renderers[node.type];
	if (!Renderer) {
		return <Unknown type={node.type} />;
	}
	const renderChildren = (children?: UINode[]): ReactNode =>
		(children ?? []).map((child) => (
			<NodeView
				key={child.id}
				onAction={onAction}
				renderers={renderers}
				value={child}
			/>
		));
	return (
		<Renderer node={node} onAction={onAction} renderChildren={renderChildren} />
	);
}
```

- [ ] **Step 3: Write the entry component**

Create `packages/ui/src/components/genui/generative-ui.tsx`:

```tsx
import type { UIAction } from "@jacksonw111/agent-client";
import type { ComponentType } from "react";
import { readRoot } from "@better-agent/ui/lib/genui-tree";
import { type NodeProps, NodeView } from "./node-view";

export type { NodeProps } from "./node-view";

export interface GenerativeUIProps {
	onAction: (action: UIAction) => void;
	renderers: Record<string, ComponentType<NodeProps>>;
	tree: unknown;
}

/** Render an agent-produced UI tree (partial during stream, final after). */
export function GenerativeUI({ tree, renderers, onAction }: GenerativeUIProps) {
	const root = readRoot(tree);
	if (root === null || root === undefined) {
		return null;
	}
	return <NodeView onAction={onAction} renderers={renderers} value={root} />;
}
```

- [ ] **Step 4: Typecheck + lint (the deliverable is type-correct, exports resolve)**

Run: `pnpm -F @better-agent/ui check-types && pnpm -F @better-agent/ui test && pnpm dlx ultracite check packages/ui/src/components/genui`
Expected: typecheck clean (resolves the new `./components/genui/*` + `./lib/genui-tree` imports), existing ui tests still PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/genui packages/ui/package.json
git commit -m "feat(ui): GenerativeUI renderer (skeleton + unknown-type fallback)"
```

---

## Task 7: apps/web starter component manifest

**Files:**
- Create: `apps/web/src/genui/manifest.ts`
- Create: `apps/web/src/genui/manifest.test.ts`

**Interfaces:**
- Consumes: `ComponentDef` (from `@jacksonw111/agent-client`), `z` (from `zod`).
- Produces: `export const MANIFEST: ComponentDef[]` and `export const COMPONENT_TYPES: string[]` covering: `Stack`, `Card`, `Heading`, `Text`, `Badge`, `Stat`, `List`, `Button`, `Form`, `TextField`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/genui/manifest.test.ts`:

```ts
import { defineComponents } from "@jacksonw111/agent-client";
import { expect, it } from "vitest";
import { COMPONENT_TYPES, MANIFEST } from "./manifest";

it("compiles into a schema with one branch per component", () => {
	const ui = defineComponents(MANIFEST);
	const schema = ui.outputSchema as Record<string, any>;
	expect(schema.$defs.UINode.anyOf).toHaveLength(MANIFEST.length);
	expect(new Set(ui.types)).toEqual(new Set(COMPONENT_TYPES));
});

it("marks containers with children and Button/Form with actions", () => {
	const byType = new Map(MANIFEST.map((d) => [d.type, d]));
	expect(byType.get("Stack")?.children).toBe(true);
	expect(byType.get("Card")?.children).toBe(true);
	expect(byType.get("Button")?.actions).toContain("press");
	expect(byType.get("Form")?.actions).toContain("submit");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F web test manifest`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the manifest**

Create `apps/web/src/genui/manifest.ts`. Use `z.toJSONSchema` for each props shape. Keep the file ≤ 300 lines (it will be ~120):

```ts
import type { ComponentDef } from "@jacksonw111/agent-client";
import { z } from "zod";

const props = (shape: z.ZodRawShape): Record<string, unknown> =>
	z.toJSONSchema(z.object(shape)) as Record<string, unknown>;

export const MANIFEST: ComponentDef[] = [
	{
		type: "Stack",
		description: "Vertical or horizontal layout container for other components.",
		props: props({ direction: z.enum(["vertical", "horizontal"]).optional() }),
		children: true,
	},
	{
		type: "Card",
		description: "A titled surface that groups related content.",
		props: props({ title: z.string().optional() }),
		children: true,
	},
	{
		type: "Heading",
		description: "A short section heading.",
		props: props({ text: z.string() }),
	},
	{
		type: "Text",
		description: "A paragraph of body text.",
		props: props({ text: z.string() }),
	},
	{
		type: "Badge",
		description: "A small status label.",
		props: props({ label: z.string(), tone: z.enum(["neutral", "success", "warning"]).optional() }),
	},
	{
		type: "Stat",
		description: "A single labeled metric value.",
		props: props({ label: z.string(), value: z.string() }),
	},
	{
		type: "List",
		description: "A bulleted list of short text items.",
		props: props({ items: z.array(z.string()) }),
	},
	{
		type: "Button",
		description: "A clickable button that emits the 'press' action.",
		props: props({ label: z.string() }),
		actions: ["press"],
	},
	{
		type: "Form",
		description: "A form wrapper; renders child TextFields and a submit button that emits 'submit'.",
		props: props({ submitLabel: z.string().optional() }),
		children: true,
		actions: ["submit"],
	},
	{
		type: "TextField",
		description: "A labeled single-line text input inside a Form.",
		props: props({ name: z.string(), label: z.string(), placeholder: z.string().optional() }),
	},
];

export const COMPONENT_TYPES: string[] = MANIFEST.map((d) => d.type);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F web test manifest`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/genui/manifest.ts apps/web/src/genui/manifest.test.ts
git commit -m "feat(web): starter generative-UI component manifest"
```

---

## Task 8: apps/web renderers map

**Files:**
- Create: `apps/web/src/genui/renderers.tsx`
- Create: `apps/web/src/genui/renderers.test.ts`

**Interfaces:**
- Consumes: `NodeProps` (from `@better-agent/ui/components/genui/generative-ui`), `COMPONENT_TYPES` (Task 7).
- Produces: `export const RENDERERS: Record<string, ComponentType<NodeProps>>` with a key for every `COMPONENT_TYPES` entry.

- [ ] **Step 1: Write the failing test (consistency guard)**

Create `apps/web/src/genui/renderers.test.ts`:

```ts
import { expect, it } from "vitest";
import { COMPONENT_TYPES } from "./manifest";
import { RENDERERS } from "./renderers";

it("has a renderer for every manifest component type", () => {
	for (const type of COMPONENT_TYPES) {
		expect(RENDERERS[type], `missing renderer for ${type}`).toBeDefined();
	}
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F web test renderers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderers**

Create `apps/web/src/genui/renderers.tsx`. Map each manifest `type` to a small presentational component reading `node.props`. Keep ≤ 300 lines; if it grows, split leaf vs container files. Read props defensively (`props` values are `unknown`). Example shape (implement all 10 types):

```tsx
import type { NodeProps } from "@better-agent/ui/components/genui/generative-ui";
import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import type { ComponentType } from "react";

const str = (v: unknown, fallback = ""): string =>
	typeof v === "string" ? v : fallback;

function Stack({ node, renderChildren }: NodeProps) {
	const horizontal = node.props.direction === "horizontal";
	return (
		<div className={horizontal ? "flex gap-3" : "flex flex-col gap-3"}>
			{renderChildren(node.children)}
		</div>
	);
}

function Card({ node, renderChildren }: NodeProps) {
	return (
		<div className="rounded-lg border p-4">
			{node.props.title ? (
				<h3 className="mb-2 font-medium text-sm">{str(node.props.title)}</h3>
			) : null}
			<div className="flex flex-col gap-2">{renderChildren(node.children)}</div>
		</div>
	);
}

function Heading({ node }: NodeProps) {
	return <h2 className="font-semibold text-lg">{str(node.props.text)}</h2>;
}

function Text({ node }: NodeProps) {
	return <p className="text-sm">{str(node.props.text)}</p>;
}

function BadgeNode({ node }: NodeProps) {
	return <Badge>{str(node.props.label)}</Badge>;
}

function Stat({ node }: NodeProps) {
	return (
		<div>
			<div className="text-muted-foreground text-xs">{str(node.props.label)}</div>
			<div className="font-semibold text-xl">{str(node.props.value)}</div>
		</div>
	);
}

function ListNode({ node }: NodeProps) {
	const items = Array.isArray(node.props.items) ? node.props.items : [];
	return (
		<ul className="list-disc pl-5 text-sm">
			{items.map((it, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static rendered list
				<li key={i}>{str(it)}</li>
			))}
		</ul>
	);
}

function ButtonNode({ node, onAction }: NodeProps) {
	return (
		<Button
			onClick={() =>
				node.action ? onAction(node.action) : onAction({ intent: "press", target: "agent" })
			}
			size="sm"
		>
			{str(node.props.label, "Button")}
		</Button>
	);
}

function FormNode({ node, onAction, renderChildren }: NodeProps) {
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(e) => {
				e.preventDefault();
				const data = Object.fromEntries(new FormData(e.currentTarget));
				onAction(node.action ?? { intent: "submit", target: "agent", payload: data });
			}}
		>
			{renderChildren(node.children)}
			<Button size="sm" type="submit">
				{str(node.props.submitLabel, "Submit")}
			</Button>
		</form>
	);
}

function TextField({ node }: NodeProps) {
	return (
		<label className="flex flex-col gap-1 text-sm">
			<span>{str(node.props.label)}</span>
			<input
				className="rounded border px-2 py-1"
				name={str(node.props.name)}
				placeholder={str(node.props.placeholder)}
			/>
		</label>
	);
}

export const RENDERERS: Record<string, ComponentType<NodeProps>> = {
	Stack,
	Card,
	Heading,
	Text,
	Badge: BadgeNode,
	Stat,
	List: ListNode,
	Button: ButtonNode,
	Form: FormNode,
	TextField,
};
```

(Confirm `@better-agent/ui/components/badge` exists; if the export differs, import the available badge or render a styled `<span>`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F web test renderers && pnpm -F web check-types`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/genui/renderers.tsx apps/web/src/genui/renderers.test.ts
git commit -m "feat(web): renderers for the starter component library"
```

---

## Task 9: apps/web mock data tools + action handlers

**Files:**
- Create: `apps/web/src/genui/tools.ts`
- Create: `apps/web/src/genui/handlers.ts`
- Create: `apps/web/src/genui/tools.test.ts`

**Interfaces:**
- Consumes: `ClientToolDef`, `UIAction` (from `@jacksonw111/agent-client`).
- Produces:
  - `export const DATA_TOOLS: ClientToolDef[]` — `listTasks`, `getStats`, `searchItems` returning JSON strings.
  - `export const HANDLERS: Record<string, (payload: unknown) => void>` — local handlers (e.g. `press`).
  - `export function routeAction(action: UIAction, deps: { handlers: Record<string, (p: unknown) => void>; sendAgentEvent: (a: UIAction) => void }): void`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/genui/tools.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { routeAction } from "./handlers";
import { DATA_TOOLS } from "./tools";

it("listTasks returns parseable JSON array", async () => {
	const tool = DATA_TOOLS.find((t) => t.name === "listTasks");
	const out = JSON.parse(await tool?.execute({}) ?? "null");
	expect(Array.isArray(out)).toBe(true);
});

it("routeAction sends to handler or agent by target", () => {
	const handler = vi.fn();
	const send = vi.fn();
	routeAction(
		{ intent: "press", target: "client", payload: 1 },
		{ handlers: { press: handler }, sendAgentEvent: send }
	);
	expect(handler).toHaveBeenCalledWith(1);
	routeAction(
		{ intent: "submit", target: "agent" },
		{ handlers: {}, sendAgentEvent: send }
	);
	expect(send).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F web test tools`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement tools**

Create `apps/web/src/genui/tools.ts`:

```ts
import type { ClientToolDef } from "@jacksonw111/agent-client";

const TASKS = [
	{ id: 1, title: "Draft proposal", done: false },
	{ id: 2, title: "Review PR", done: true },
];
const ITEMS = ["Apples", "Bananas", "Cherries", "Dates"];

export const DATA_TOOLS: ClientToolDef[] = [
	{
		name: "listTasks",
		description: "List the current user's tasks.",
		parameters: { type: "object", properties: {} },
		execute: () => Promise.resolve(JSON.stringify(TASKS)),
	},
	{
		name: "getStats",
		description: "Get summary stats for the dashboard.",
		parameters: { type: "object", properties: {} },
		execute: () =>
			Promise.resolve(
				JSON.stringify({ open: 1, done: 1, total: TASKS.length })
			),
	},
	{
		name: "searchItems",
		description: "Search items by a query substring.",
		parameters: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
		execute: (args) => {
			const query = String((args as { query?: unknown }).query ?? "").toLowerCase();
			return Promise.resolve(
				JSON.stringify(ITEMS.filter((i) => i.toLowerCase().includes(query)))
			);
		},
	},
];
```

- [ ] **Step 4: Implement handlers + routeAction**

Create `apps/web/src/genui/handlers.ts`:

```ts
import type { UIAction } from "@jacksonw111/agent-client";
import { toast } from "sonner";

export const HANDLERS: Record<string, (payload: unknown) => void> = {
	press: () => toast("Button pressed"),
};

interface RouteDeps {
	handlers: Record<string, (payload: unknown) => void>;
	sendAgentEvent: (action: UIAction) => void;
}

/** A2 routing: local intents run their handler; semantic intents go to the agent. */
export function routeAction(action: UIAction, deps: RouteDeps): void {
	if (action.target === "client") {
		const handler = deps.handlers[action.intent];
		if (handler) {
			handler(action.payload);
		}
		return;
	}
	deps.sendAgentEvent(action);
}
```

- [ ] **Step 5: Run test + commit**

Run: `pnpm -F web test tools`
Expected: PASS (2 tests).

```bash
git add apps/web/src/genui/tools.ts apps/web/src/genui/handlers.ts apps/web/src/genui/tools.test.ts
git commit -m "feat(web): mock data tools + A2 action routing"
```

---

## Task 10: apps/web `<GenerativeUIView>`

**Files:**
- Create: `apps/web/src/components/genui/genui-view.tsx`

**Interfaces:**
- Consumes: `defineComponents` + `MANIFEST` (Task 7), `RENDERERS` (Task 8), `DATA_TOOLS` + `HANDLERS` + `routeAction` (Task 9), `GenerativeUI` renderer (Task 6), `AgentClient` (from `@jacksonw111/agent-client`).
- Produces: `function GenerativeUIView({ agentClient }: { agentClient: AgentClient }): ReactNode`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/genui/genui-view.tsx` (keep ≤ 300 lines, functions ≤ 50; extract the stream loop into a hook):

```tsx
import { Button } from "@better-agent/ui/components/button";
import { GenerativeUI } from "@better-agent/ui/components/genui/generative-ui";
import { type AgentClient, defineComponents, type UIAction } from "@jacksonw111/agent-client";
import { useMemo, useRef, useState } from "react";
import { HANDLERS, routeAction } from "@/genui/handlers";
import { MANIFEST } from "@/genui/manifest";
import { RENDERERS } from "@/genui/renderers";
import { DATA_TOOLS } from "@/genui/tools";

const SESSION = "genui-demo";

function usePromptStream(agentClient: AgentClient, outputSchema: Record<string, unknown>) {
	const [tree, setTree] = useState<unknown>(null);
	const [busy, setBusy] = useState(false);
	const sessionRef = useRef<string | undefined>(undefined);

	const run = async (text: string) => {
		setBusy(true);
		try {
			for await (const ev of agentClient.stream(text, {
				sessionId: sessionRef.current,
				outputSchema,
				tools: DATA_TOOLS,
			})) {
				if (ev.type === "structured-delta") {
					setTree(ev.partial);
				} else if (ev.type === "done") {
					setTree((ev as { structured?: unknown }).structured ?? null);
				}
			}
		} finally {
			setBusy(false);
		}
	};
	// A fixed session id keeps the demo single-threaded; create it once.
	if (sessionRef.current === undefined) {
		sessionRef.current = `${SESSION}-${Math.round(performance.now())}`;
	}
	return { tree, busy, run };
}

export function GenerativeUIView({ agentClient }: { agentClient: AgentClient }) {
	const ui = useMemo(() => defineComponents(MANIFEST), []);
	const { tree, busy, run } = usePromptStream(agentClient, ui.outputSchema);
	const [text, setText] = useState("");

	const onAction = (action: UIAction) =>
		routeAction(action, {
			handlers: HANDLERS,
			sendAgentEvent: (a) =>
				run(`[ui-event] intent=${a.intent} payload=${JSON.stringify(a.payload ?? null)}`),
		});

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
			<form
				className="flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (text.trim() && !busy) {
						run(text.trim());
						setText("");
					}
				}}
			>
				<input
					className="flex-1 rounded border px-3 py-2"
					onChange={(e) => setText(e.target.value)}
					placeholder="Describe a UI to generate…"
					value={text}
				/>
				<Button disabled={busy} type="submit">
					{busy ? "Generating…" : "Generate"}
				</Button>
			</form>
			<div className="rounded-lg border p-4">
				<GenerativeUI onAction={onAction} renderers={RENDERERS} tree={tree} />
			</div>
		</div>
	);
}
```

(`Math.round(performance.now())` keeps a stable per-mount session id without `Date.now`. If lint flags the magic-number, extract or use `crypto.randomUUID()`.)

- [ ] **Step 2: Typecheck**

Run: `pnpm -F web check-types && pnpm dlx ultracite check apps/web/src/components/genui apps/web/src/genui`
Expected: typecheck clean, lint clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/genui/genui-view.tsx
git commit -m "feat(web): GenerativeUIView — prompt, stream, partial render, actions"
```

---

## Task 11: apps/web `/genui` route

**Files:**
- Create: `apps/web/src/routes/genui.tsx`

**Interfaces:**
- Consumes: `userAgentClient` (from `@/utils/chat-client`), `orpc` (from `@/utils/orpc`), `GenerativeUIView` (Task 10).

- [ ] **Step 1: Write the route**

Create `apps/web/src/routes/genui.tsx`. It picks the first available agent (demo) and renders the view:

```tsx
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { GenerativeUIView } from "@/components/genui/genui-view";
import { userAgentClient } from "@/utils/chat-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/genui")({
	component: GenUiPage,
});

function GenUiPage() {
	const agentsQuery = useQuery(orpc.agents.list.queryOptions());
	const agent = agentsQuery.data?.[0] ?? null;
	const agentClient = useMemo(
		() => (agent ? userAgentClient(agent.id) : null),
		[agent]
	);
	if (agentsQuery.isPending) {
		return <Skeleton className="m-4 h-24" />;
	}
	if (!agentClient) {
		return <p className="p-4 text-sm">No agent available. Create one first.</p>;
	}
	return <GenerativeUIView agentClient={agentClient} />;
}
```

- [ ] **Step 2: Typecheck + route-tree generation**

Run: `pnpm -F web check-types`
Expected: clean. (TanStack route tree regenerates on dev; if a generated `routeTree.gen.ts` is committed, run the app's `dev`/`build` once so the route registers — note this for manual verification.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/genui.tsx
git commit -m "feat(web): /genui playground route"
```

---

## Task 12: Caching regression guard + manifest-stability note

**Files:**
- Modify: `packages/agent/src/tool/registry.test.ts` (add an assertion)
- Modify: `docs/superpowers/specs/2026-06-28-generative-ui-design.md` (a one-line note already present; no change needed if so)

**Interfaces:** none new.

- [ ] **Step 1: Add the regression test**

In `packages/agent/src/tool/registry.test.ts`, add a test asserting that when `cacheLastToolDef: true`, the LAST tool def is the one carrying `anthropic.cacheControl` (guards against future reordering that would push `StructuredOutput` — and its schema — out of the cached prefix):

```ts
it("caches the last tool def so a trailing structured-output schema stays cached", () => {
	const tools = buildTools(
		[defOmega, defAlpha], // two defs; alpha is last
		ctxBase,
		{ cacheLastToolDef: true }
	);
	const last = (tools.alpha as { providerOptions?: Record<string, unknown> })
		.providerOptions;
	expect(last).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
});
```

(Match the existing test's fixture names — reuse `defOmega`/`defAlpha`/`ctxBase` or whatever the file defines; the existing "tags only the last tool def" test shows the shape.)

- [ ] **Step 2: Run test + commit**

Run: `pnpm -F @better-agent/agent test registry`
Expected: PASS.

```bash
git add packages/agent/src/tool/registry.test.ts
git commit -m "test(agent): guard structured-output schema stays in the cached tool prefix"
```

---

## Final verification (whole-branch)

- [ ] **Run all touched suites + typechecks:**

```bash
pnpm -F @jacksonw111/agent-client test && pnpm -F @jacksonw111/agent-client check-types
pnpm -F @better-agent/agent test && pnpm -F @better-agent/agent check-types
pnpm -F @better-agent/ui test && pnpm -F @better-agent/ui check-types
pnpm -F web check-types
```

Expected: all green.

- [ ] **SDK build still produces a clean d.ts (new exports bundle):**

```bash
pnpm -F @jacksonw111/agent-client build
```

Expected: build succeeds; `dist/index.d.ts` includes `defineComponents`, `UINode`, `ComponentDef`.

- [ ] **Lint the whole change:**

```bash
pnpm dlx ultracite check
```

Expected: clean (or auto-fixed via `pnpm dlx ultracite fix`).

- [ ] **Manual test setup (documented, not code):** in apps/admin, create a "Generative UI Demo" agent with a system prompt instructing it to (1) fetch data via the available tools first, then (2) call `StructuredOutput` to return a `{ root }` UI tree composed only of the registered components. Then on `dev` (after the GitHub Action deploys), open `/genui`, type a prompt (e.g. "show my open tasks as a list in a card"), and confirm the tree streams in and a Button/Form action fires.

---

## Self-Review

**Spec coverage:**
- Contracts (`ComponentDef`/`UINode`/SDK `defineComponents`/`validate`) → Task 1. ✓
- Client-tools data loop on the user plane → Task 2. ✓
- Component-level streaming (`structured-delta`, drain branch, partial parse) → Tasks 3–4. ✓
- Generic renderer (skeleton/commit-on-complete/unknown fallback, stable `id` keys) → Tasks 5–6. ✓
- apps/web playground (library, mock tools, handlers, view, route) → Tasks 7–11. ✓
- L1 caching baseline (schema already in cached prefix) + regression guard → Task 12; deterministic serialization is the client's responsibility (manifest stability), documented in the spec. ✓
- A2 action routing → Task 9 (`routeAction`) + Task 10 wiring. ✓
- Error handling: unknown type fallback (Task 6), validate rejects malformed (Task 1), tools never reject (Task 9 returns strings). ✓
- L2 minification / L3 progressive disclosure → deferred (Phase 2), not in this plan, per spec. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `UINode`/`ComponentDef`/`UIAction`/`GenerativeUI` defined in Task 1 and consumed unchanged in Tasks 5–10; `NodeProps`/`GenerativeUIProps` defined in Task 6 and consumed in Task 8/10; `routeAction` signature defined in Task 9 and used in Task 10; `structured-delta` shape defined in Task 4 and consumed in Task 10. ✓
