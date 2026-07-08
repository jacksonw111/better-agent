# AI Agent Runtime

The session runtime turns one user prompt into one or more model turns — streaming output to the client, persisting every delta to the database, driving multi-step tool loops, compacting long histories, retrying transient failures, and honoring cancellation — all behind a single `runTurn` async generator.

## Architecture

The runtime is assembled around dependency injection. `createSessionRuntime(deps)` (`runtime.ts:265`) returns a `SessionRuntime` whose only method is:

```ts
interface SessionRuntime {
  runTurn(input: RunTurnInput): AsyncGenerator<RunEvent, Message>;
}
```

`SessionRuntimeDeps` (`runtime.ts:50`) carries every store and collaborator the runtime needs — no globals, no service locator:

```ts
interface SessionRuntimeDeps {
  agentStore: AgentStore;
  attachmentStore?: AttachmentStore;
  cancellation?: CancellationRegistry;
  clock?: () => Date;
  messageStore: MessageStore;
  modelCacheStore: ModelCacheStore;
  modelFactory: ModelFactory;
  providerCatalogStore: ProviderCatalogStore;
  sessionLock: SessionLock;
  sessionStore: SessionStore;
  sleep?: (ms: number) => Promise<void>;
  summarizer: Summarizer;
  titler?: Titler;
  usageRecordStore?: UsageRecordStore; // optional dual-write target (Task 3)
}
```

This makes the runtime fully testable with in-memory fakes and lets the server swap in Redis/Upstash-backed implementations of the lock, cancellation, and pending-tool stores without touching turn logic.

### The `runTurn` flow

`runTurn` (`runtime.ts:267`) wraps `executeTurn` (`runtime.ts:216`) in three cross-cutting concerns:

1. **Session lock** — `acquire` the lock before doing anything; throw `SessionBusyError` if held. `release` runs in `finally`.
2. **Cancellation** — merge the caller's `AbortSignal` with a fresh controller, then `register` it so an out-of-band `cancel(sessionId)` can abort the in-flight turn. `unregister` runs in `finally`.
3. **The turn itself** — `executeTurn` runs the steps below and returns the final `Message`.

`executeTurn` proceeds:

1. **Load context** (`turn-messages.ts:57` `loadContext`) — fetch the `Session` and its bound `AgentConfig`.
2. **Persist the user turn** (`turn-messages.ts:92` `persistUserTurn`) — create a `user` message (status `complete`) with a `text` part, plus `file` parts for any attachments.
3. **Kick off titling** (`titler.ts:10` `maybeTitle`) — a fire-and-forget promise; see [Auto-Titling](#auto-titling).
4. **Prepare messages** (`runtime.ts:189` `prepareMessages`) — build the `ModelMessage[]` (with compaction if needed) and apply the provider's cache policy.
5. **Prepare tool binding** (`runtime.ts:204` `prepareToolBinding`) — possibly enter deferred-binding mode (see [Deferred Tool Binding]).
6. **Build assistant context** (`runtime-support.ts:13` `buildAssistantCtx`) — create the `assistant` message row (status `streaming`) and the `DrainCtx`.
7. **Stream** (`runtime.ts:241` `streamAssistant`) — run the model with retries, draining every chunk.
8. **Finalize** (`runtime-finalize.ts:89` `finalizeAssistant`) — price usage, dual-write to `usage_records`, set final status/error, emit `done`/`error`.
9. **Settle title** (`runtime-support.ts:39` `settleTitleEvent`) — await the title promise and emit a `title` event.

## Key Files

| File | Responsibility |
|------|----------------|
| `runtime.ts` | `createSessionRuntime`, `runTurn`, `executeTurn`, DI container |
| `runtime-drain.ts` | `drainStream` — the chunk dispatch loop |
| `runtime-finalize.ts` | `finalizeAssistant` — pricing, `usage_records` dual-write, status, terminal events |
| `runtime-support.ts` | `buildAssistantCtx`, `settleTitleEvent` |
| `part-buffer.ts` | `createPartBuffer` — throttled incremental persistence |
| `compaction.ts` | Boundary selection, summary prompt, `compactSession` |
| `token-estimate.ts` | Cheap char-based estimate, 80% overflow check |
| `doom-loop.ts` | Consecutive-identical-call guard |
| `retry-helpers.ts` | Backoff math, `shouldRetryAttempt` |
| `error-classify.ts` | `classifyError` → retryable / fatal / content-filter / aborted |
| `cancellation.ts` | `CancellationRegistry` interface + in-memory impl |
| `session-lock.ts` | `SessionLock` interface + in-memory impl, `SessionBusyError` |
| `titler.ts` / `model-titler.ts` | First-turn title generation |
| `model-summarizer.ts` | LLM-backed `Summarizer` for compaction |
| `turn-messages.ts` | `buildTurnMessages`, `persistUserTurn`, `loadContext` |
| `to-model-messages.ts` | History → AI SDK `ModelMessage[]` |
| `stream-mapping.ts` | Map AI SDK usage/finishReason to internal types |
| `dynamic-context.ts` | Day-precision date appended to the system prompt |
| `events.ts` | `RunEvent` discriminated union |
| `types.ts` | `Session`, `Message`, `MessagePart`, status enums |
| `apps/server/src/redis-session-lock.ts` | Redis `SET NX PX` lock (5 min TTL) |
| `apps/server/src/redis-cancellation.ts` | Redis pub/sub cancellation |
| `apps/server/src/upstash-cancellation.ts` | Upstash poll-based cancellation |

(All paths under `packages/agent/src/session/` unless prefixed.)

## Data Flow

### Streaming: PartBuffer + drainStream

The model's `fullStream` is consumed by `drainStream` (`runtime-drain.ts:87`), which pattern-matches chunk types:

| Chunk | Action | Event yielded |
|-------|--------|---------------|
| `text-delta` | `bufs.text.append(chunk.text)` | `text-delta` |
| `reasoning-delta` | `bufs.reasoning.append(chunk.text)` | `reasoning-delta` |
| `tool-call` | append a `tool-call` part, mark `emittedOutput` | `tool-call` |
| `tool-result` / `tool-error` | append a `tool-result` part | `tool-result` |
| `finish-step` | `bufs.*.finishStep()` (close the part, reset buffers for the next step) | `step-finish` |
| `finish` | record usage + finishReason into `state` | — |
| `error` / `abort` | set `state.status` | — |

`PartBuffer` (`part-buffer.ts`) is the durability mechanism. On the **first** delta it inserts a part row (status `streaming`); thereafter it writes at most once per `PERSIST_THROTTLE_MS` (250ms, `part-buffer.ts:4`); `flush` finalizes the status. A mid-stream crash therefore leaves partial text durable rather than losing the whole message. `finishStep` (`part-buffer.ts:78`) closes the current part and resets the buffer so a multi-step turn produces one text part per step.

`emittedOutput` (`retry-helpers.ts:7`) is the no-partial-throw guard: once any delta has reached the client, a subsequent error is **not** retried (see [Retry & Backoff](#retry--backoff)).

### Finalize & Usage Records

After the stream settles, `finalizeAssistant` (`runtime-finalize.ts:89`) does four things:

1. **Price** — `withCost` (`runtime-finalize.ts:22`) looks up the model entry and calls `priceUsage` to get USD; converts to integer `costCents` (`runtime-finalize.ts:34`).
2. **Persist the message** — `updateMessage` writes the final `status`, `usage`, `finishReason`, and `error`.
3. **Dual-write usage** — when `session.userId !== null`, `recordChatUsage` (`runtime-finalize.ts:75`) inserts a `usage_records` snapshot (tokens, cost, provider, model, dedup key `chat:<assistantId>`). This is **best-effort**: an insert failure is logged and swallowed, never failing the turn — the legacy `messages.usage` write above already succeeded.
4. **Emit** — `done` (with usage + finishReason) or `error`, and flips the session status to `active`/`error`.

### Compaction

Triggered inside `buildTurnMessages` (`turn-messages.ts:121`) only when the estimated token count exceeds 80% of the model's context limit (`token-estimate.ts:5` `COMPACT_THRESHOLD = 0.8`). The estimate is deliberately cheap: chars/4 + 4 tokens/message overhead (`token-estimate.ts:14`).

`compactSession` (`compaction.ts:50`):

1. `selectCompactionBoundary` (`compaction.ts:17`) — keep the last `KEEP_RECENT_MESSAGES` (6) messages; the boundary is the seq of the message just before them. Returns `null` (no compaction) when history is short.
2. Compute the **incremental** slice: messages with `seq > session.compactedThroughSeq` and `seq <= boundary`. Nothing already summarized is re-summarized.
3. `buildSummaryPrompt` (`compaction.ts:35`) folds the prior summary (if any) plus the rendered messages into one prompt.
4. The injected `Summarizer` (`model-summarizer.ts:8`) calls `generateText` on the agent's own provider/model with a compaction system prompt.
5. `sessionStore.setSummary(sessionId, summary, boundary)` persists the new summary and advances the `compactedThroughSeq` **watermark**.

On the next turn, `toModelMessages` (`to-model-messages.ts:178`) sees `summary !== null`, prepends it as a `system` message, and **filters out** every message with `seq <= compactedThroughSeq` — so summarized history is never sent twice.

### Multi-Step Tool Loop

The AI SDK drives the loop. `streamText` is called with `stopWhen: stepCountIs(DEFAULT_MAX_STEPS)` (`runtime.ts:129`, `DEFAULT_MAX_STEPS = 50` at `runtime.ts:48`). Each `tool-call` → execute → `tool-result` cycle is one "step"; the SDK continues until the model stops calling tools or hits 50 steps.

Tool execution goes through `buildTools` (`registry.ts:10`), which wraps every `ToolDef.execute` with three concerns: the doom-loop guard, output truncation, and error→throw conversion (so the model sees tool failures as `tool-error` chunks).

### Doom-Loop Guard

`createDoomLoopGuard` (`doom-loop.ts:15`) tracks the last `(toolName, args)` signature. On the **3rd** consecutive identical call (`DOOM_LOOP_THRESHOLD = 3`, `doom-loop.ts:1`), `buildTools` short-circuits and returns `DOOM_LOOP_MESSAGE` instead of executing (`registry.ts:36`). This nudges the model out of pathological repetition without failing the turn.

### Retry & Backoff

`streamAssistant` (`runtime.ts:151`) loops up to `MAX_LLM_ATTEMPTS` (3, `retry-helpers.ts:3`). `shouldRetryAttempt` (`retry-helpers.ts:34`) is true only when:

- `state.status === "error"`,
- **no output was emitted** (`!emittedOutput`) — the no-partial-throw rule,
- the error classifies as `retryable`,
- attempts remain, and
- the turn was not aborted.

Backoff is exponential: `backoffMs(attempt) = BASE_BACKOFF_MS * 2^(attempt-1)` → 500ms, 1000ms, 2000ms (`retry-helpers.ts:21`). `classifyError` (`error-classify.ts:28`) marks HTTP 408/409/425/429/500/502/503/504, `isRetryable === true`, and known transient messages (timeout, overloaded, rate limit) as retryable; content-filter errors and everything else are fatal; aborts are their own category.

### Cancellation

The `CancellationRegistry` interface (`cancellation.ts:1`) has `register` / `unregister` / `cancel`. `runTurn` registers the turn's `AbortController`, and the merged `abortSignal` flows down to `streamText` and into every tool's `ToolContext`.

Two distributed implementations exist because in-process registries can't reach across server instances or Cloudflare isolates:

- **Redis pub/sub** (`apps/server/src/redis-cancellation.ts`) — `cancel` publishes on `session-cancel`; a dedicated subscriber aborts the matching controller.
- **Upstash poll** (`apps/server/src/upstash-cancellation.ts`) — `cancel` SETs a flag (60s TTL); each live turn polls GET every 750ms. Used on Workers where a long-lived subscriber isn't viable.

### Session Lock

`SessionLock` (`session-lock.ts:1`) is `acquire(sessionId): Promise<boolean>` / `release`. The in-memory impl (`session-lock.ts:18`) uses a `Set`. The Redis impl (`apps/server/src/redis-session-lock.ts:26`) does `SET key token PX 300000 NX` (5 min TTL) and releases via a Lua compare-and-delete script guarded by the owner token — so a turn that outlives its TTL never deletes a successor's lock.

### Auto-Titling

`maybeTitle` (`titler.ts:10`) generates a title **only on the first turn** (`session.title == null`), returns `null` if no titler is wired, and `.catch(() => null)` so a titler failure never breaks the turn. The concrete titler (`model-titler.ts:8`) calls `generateText` with a 6-word-max system prompt on the agent's own model. It's fire-and-forget: `executeTurn` does not await it before streaming — it's awaited only at the end in `settleTitleEvent`, which persists the title and emits a `title` event.

### Session Persistence

Two tables back a session (`packages/db/src/schema/sessions.ts`):

- **`messages`** — one row per message, with a per-session monotonic `seq` (unique index `messages_session_seq`). `seq` is assigned in-app by `nextSeq` (`message-store.ts:46`) inside a transaction that reads existing seqs and takes max+1.
- **`message_parts`** — one row per part (text/reasoning/tool-call/tool-result/file), per-message monotonic `seq` (unique index `message_parts_message_seq`).

`type` and `content` are stored as independent columns; the DB can't express their correspondence, so the repository asserts the shape at the boundary (`message-store.ts:33`). The `MessageStore` (`message-store.ts:117`) is driver-agnostic — its `Db` type (`message-store.ts:9`) is satisfied by both `node-postgres` (`packages/db/src/node-db.ts`) and Neon serverless (`packages/db/src/neon-db.ts`), and PGlite in tests.

## Design Rationale

- **DI over globals** — every store and collaborator is a constructor argument. This keeps the runtime pure, makes fakes trivial in tests, and lets the server pick Redis vs Upstalk vs in-memory per deployment target without branching inside turn logic.
- **250ms throttle, not every delta** — writing a part row on every token would overwhelm Postgres. The throttle caps writes to ~4/sec while still making progress visible to a polling client and durable within a quarter-second.
- **Incremental compaction watermark** — `compactedThroughSeq` means the summarizer only ever folds the *new* slice since the last compaction, keeping compaction cost proportional to growth, not history length.
- **No-partial-throw retry** — retrying after the client has already seen tokens would duplicate output and corrupt the persisted message. Once `emittedOutput` is true, the error stands.
- **Doom-loop as a nudge, not a failure** — returning a corrective string keeps the turn alive and lets the model self-correct, rather than hard-failing the whole turn.
- **Token-guarded lock release** — a fixed TTL could let a long turn's lock expire; the Lua release script ensures only the current owner ever deletes the key, preventing corruption even in that window.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| Max steps per turn | `runtime.ts:48` | 50 | `DEFAULT_MAX_STEPS`, fed to `stepCountIs` |
| Part persist throttle | `part-buffer.ts:4` | 250 ms | `PERSIST_THROTTLE_MS` |
| Compaction threshold | `token-estimate.ts:5` | 0.8 | `COMPACT_THRESHOLD` of context limit |
| Messages kept after compaction | `compaction.ts:5` | 6 | `KEEP_RECENT_MESSAGES` |
| Max LLM attempts | `retry-helpers.ts:3` | 3 | `MAX_LLM_ATTEMPTS` |
| Base backoff | `retry-helpers.ts:4` | 500 ms | `BASE_BACKOFF_MS`; doubles each attempt |
| Doom-loop threshold | `doom-loop.ts:1` | 3 | `DOOM_LOOP_THRESHOLD` consecutive identical calls |
| Session lock TTL | `apps/server/src/redis-session-lock.ts:16` | 300000 ms (5 min) | `LOCK_TTL_MS` |
| Upstash cancel poll | `apps/server/src/upstash-cancellation.ts:4` | 750 ms | `POLL_INTERVAL_MS` |
| Upstash cancel flag TTL | `apps/server/src/upstash-cancellation.ts:5` | 60 s | `CANCEL_TTL_SEC` |

[Deferred Tool Binding]: ../02-tool-system.md#deferred-tool-binding
