# Tool System

The tool system assembles the tools an agent may call, adapts them to the AI SDK's `ToolSet`, hides bulky tool sets behind a `search_tools` gateway, and integrates remote (pending), MCP, and Composio tools behind uniform `ToolDef` boundaries.

## Architecture

Every tool, regardless of origin, is described by a single `ToolDef` (`packages/agent/src/tool/types.ts:16`):

```ts
interface ToolDef {
  defer?: boolean;        // hide behind search_tools past the threshold
  description: string;
  execute(args: unknown, ctx: ToolContext): Promise<ExecuteResult>;
  name: string;
  parameters: JsonSchema;
}

interface ToolContext {
  abortSignal: AbortSignal;
  agentId: string;
  callId: string;
  messageId: string;
  sessionId: string;
}

interface ExecuteResult {
  isError?: boolean;
  output: string;
}
```

At turn time, `buildTools` (`registry.ts:10`) converts a `ToolDef[]` into an AI SDK `ToolSet`, wrapping each `execute` with three cross-cutting concerns:

1. **Doom-loop guard** — short-circuits the 3rd consecutive identical call.
2. **Output truncation** — caps at 50 KB / 2000 lines.
3. **Error conversion** — `ExecuteResult.isError` becomes a thrown `Error`, which the AI SDK surfaces as a `tool-error` chunk so the model can react.

A registry of providers (built-in, composio, MCP, remote/pending) each produce `ToolDef[]`, which the API layer assembles per agent and per turn.

## Key Files

| File | Responsibility |
|------|----------------|
| `packages/agent/src/tool/types.ts` | `ToolDef`, `ToolContext`, `ExecuteResult`, `JsonSchema` |
| `packages/agent/src/tool/registry.ts` | `buildTools` — `ToolDef[]` → AI SDK `ToolSet` |
| `packages/agent/src/tool/truncate.ts` | `truncateOutput` — 50 KB / 2000 line cap |
| `packages/agent/src/tool/builtin-tools.ts` | `get_current_time` + opt-in registry |
| `packages/agent/src/tool/remote-tools.ts` | `buildRemoteToolDefs` — park client-defined tools |
| `packages/agent/src/tool/pending-store.ts` | `PendingToolCallStore` interface + in-memory impl, 2 min TTL |
| `packages/agent/src/tool/tool-search.ts` | `search_tools`, `shouldDefer`, `buildDeferredBinding` |
| `packages/agent/src/tool/mcp-tools.ts` | `McpService` interface, `buildMcpToolDefs` |
| `packages/agent/src/tool/composio-tools.ts` | `ComposioService` interface, `buildComposioToolDefs` |
| `packages/api/src/routers/agent-tool-defs.ts` | `assembleAgentToolDefs`, `safeComposioDefs`, `safeMcpDefs` |
| `apps/server/src/redis-pending-store.ts` | Redis pub/sub `PendingToolCallStore` |
| `apps/server/src/upstash-pending-store.ts` | Upstash REST `PendingToolCallStore` |

## Data Flow

### Tool Registry

`buildTools` (`registry.ts:10`) is the single seam between `ToolDef` and the AI SDK:

```ts
function buildTools(
  defs: ToolDef[],
  ctxBase: Omit<ToolContext, "callId">,
  opts?: { cacheLastToolDef?: boolean; guard?: DoomLoopGuard }
): ToolSet
```

For each def it builds an AI SDK `tool({ ... })` whose `execute`:

- checks `opts.guard?.check(def.name, args)` and returns `DOOM_LOOP_MESSAGE` if tripped (`registry.ts:36`),
- calls `def.execute(args, ctx)` with the AI SDK's `toolCallId` wired in as `callId`,
- runs the output through `truncateOutput` (`registry.ts:44`),
- throws on `result.isError` so the SDK emits a `tool-error` chunk.

`cacheLastToolDef` tags the **last** tool's schema with Anthropic `cacheControl: { type: "ephemeral" }` (`registry.ts:25`), so the entire tool block (the most expensive part of the prompt) is cached as one prefix. Only set when the provider is Anthropic and the cache policy enables it. A duplicate tool name throws immediately (`registry.ts:17`).

### Output Truncation

`truncateOutput` (`truncate.ts:8`) enforces two ceilings — `MAX_OUTPUT_LINES = 2000` (`truncate.ts:2`) then `MAX_OUTPUT_BYTES = 51200` (`truncate.ts:1`, exactly 50 KB). When either is exceeded it keeps the **head** and appends `[output truncated — N chars total; showing the head]` so the model knows data was dropped.

### Built-in Tools

Server-executed tools that need no external credentials. Agents opt in **by id** via `AgentConfig.builtinTools`. The registry (`builtin-tools.ts:21`) currently holds exactly one:

- `get_current_time` (`builtin-tools.ts:14`) — returns `new Date().toISOString()`.

`BUILTIN_TOOLS` (`builtin-tools.ts:26`) is metadata for the admin UI's picker (id/label/category/description). `buildBuiltinToolDefs(ids)` (`builtin-tools.ts:35`) filters the registry by the agent's selected ids. These are **not** marked `defer` — they're few and cheap to include directly.

### Remote / Pending Tools

Client-defined tools whose execution happens outside the server (e.g. a desktop bridge agent). `buildRemoteToolDefs` (`remote-tools.ts:10`) turns client-supplied schemas into `ToolDef[]` whose `execute` doesn't run anything — it **parks** the call:

```ts
execute: (_args, ctx) =>
  store.park({ sessionId: ctx.sessionId, callId: ctx.callId, abortSignal: ctx.abortSignal })
```

`PendingToolCallStore` (`pending-store.ts:5`) is the park/resolve protocol:

```ts
interface PendingToolCallStore {
  park(input: { sessionId; callId; abortSignal? }): Promise<ExecuteResult>;
  resolve(input: { sessionId; callId; result }): Promise<void>;
}
```

The in-memory impl (`pending-store.ts:22`) holds a `Map<key, settle>`. `park` returns a promise that resolves when `resolve` is called for the same `(sessionId, callId)`, rejects on abort, and **auto-rejects after `PENDING_TTL_MS = 120_000`** (2 min, `pending-store.ts:3`). The key is `${sessionId}:${callId}` (`pending-store.ts:18`).

Distributed implementations:

- **Redis** (`apps/server/src/redis-pending-store.ts:48`) — `park` subscribes to channel `toolresult:${sessionId}:${callId}`; `resolve` publishes the JSON-serialized result. Causal ordering holds because the client only calls `submitToolResult` after receiving the `tool-call` event, which fires only after `park` has subscribed.
- **Upstash** (`apps/server/src/upstash-pending-store.ts`) — poll-based variant for Workers.

### Deferred Tool Binding (`search_tools`)

When an agent has many tools, sending every schema every turn is expensive. `shouldDefer` (`tool-search.ts:56`) returns true when more than `DEFER_THRESHOLD = 12` (`tool-search.ts:5`) defs are marked `defer: true`. Below the threshold, behavior is unchanged.

When deferral is active, `buildDeferredBinding` (`tool-search.ts:148`):

1. Splits defs into always-active (non-`defer`) and deferred (`defer`).
2. Seeds the active set with all non-deferred names **plus** `search_tools`.
3. Appends a synthetic `search_tools` tool (`tool-search.ts:79`) to the registered set.

The runtime then uses the AI SDK's `prepareStep` to expose only `activeNames()` as `activeTools` each step (`runtime.ts:99` `deferStepOptions`). `search_tools.execute` ranks the deferred defs against the query and **adds** matching names to the active set — which only grows within a turn.

Ranking (`tool-search.ts:28` `scoreDef`) is a token-overlap score: name matches weigh 3× (`NAME_WEIGHT`, `tool-search.ts:7`), description matches weigh 1. `tokenize` (`tool-search.ts:21`) lowercases and splits on non-alphanumerics, dropping tokens shorter than 2 chars. `rankTools` (`tool-search.ts:44`) keeps only positive scores, sorted descending. `runSearch` (`tool-search.ts:105`) takes the top 8 (`SEARCH_TOP_K`, `tool-search.ts:6`) per query and supports a batched `queries` array so the model fetches everything it needs in one call.

### MCP Tools

`McpService` (`mcp-tools.ts:10`) is the interface for a connected remote MCP server:

```ts
interface McpService {
  execute(input: { toolName: string; args: unknown }): Promise<ExecuteResult>;
  listTools(): Promise<McpToolMeta[]>;
}
```

`buildMcpToolDefs` (`mcp-tools.ts:16`) calls `listTools()` once and maps each meta into a `ToolDef` whose `execute` delegates to `service.execute({ toolName, args })`. The concrete `McpService` (connection, auth, transport) lives in the server app — see [04-mcp.md](./04-mcp.md).

### Composio Tools

`ComposioService` (`composio-tools.ts:25`) abstracts Composio's toolkit catalog, per-user connections, and tool execution. Auth comes in two flavors visible at the interface level:

- **OAuth** — `connect(userId, toolkit)` returns a redirect URL (`composio-tools.ts:27`), for toolkits whose `authSchemes` includes `OAUTH2`.
- **API key** — `connectWithKey({ userId, toolkit, scheme, key })` (`composio-tools.ts:29`), for `API_KEY` / `BEARER_TOKEN` toolkits.

`buildComposioToolDefs` (`composio-tools.ts:52`) calls `listTools(userId, toolkits)` — scoped to the user's **active** connections — and maps each into a `ToolDef` whose `execute` calls `service.execute({ userId, toolName, args })`. Toolkits are listed in parallel (one request each), not sequentially.

### Tool Assembly

`assembleAgentToolDefs` (`packages/api/src/routers/agent-tool-defs.ts:75`) is the per-turn entry point that gathers every tool an agent can call:

```ts
async function assembleAgentToolDefs(context, agent: {
  builtinTools: string[];
  composioAccountIds: string[];
  mcpServerIds: string[];
  toolAllowlist?: string[] | null;
}): Promise<ToolDef[]>
```

It runs the three sources in parallel:

1. **Composio** — `Promise.all` over `composioAccountIds`, each through `safeComposioDefs` (`agent-tool-defs.ts:16`). Per account: list active connections → unique toolkit slugs → `buildComposioToolDefs`. Failures are logged and yield `[]` (a broken account never breaks the turn).
2. **MCP** — `Promise.all` over `mcpServerIds`, each through `safeMcpDefs` (`agent-tool-defs.ts:43`), which wraps `buildMcpToolDefs` in try/catch for the same reason.
3. **Built-in** — `buildBuiltinToolDefs(agent.builtinTools)`.

`shapeSourceDefs` (`agent-tool-defs.ts:63`) then applies two transforms to the composio+MCP union:

- the optional `toolAllowlist` (name allowlist), and
- `defer: true` on **every** surviving composio/MCP def — they're bulky and numerous, so they always become search-gatewayed.

Built-in tools are appended **after** shaping and are **not** deferred.

## Design Rationale

- **Uniform `ToolDef`** — one shape spans built-in, remote, MCP, and Composio tools. The runtime never branches on tool origin; `buildTools` is the only place that touches the AI SDK.
- **`defer` opt-in at the source** — Composio/MCP mark themselves deferrable; built-ins don't. The runtime's `shouldDefer` decides whether to engage the gateway based on count, so behavior degrades gracefully (small tool sets are never gated).
- **`search_tools` grows a set, never shrinks** — once surfaced, a tool stays callable for the rest of the turn, avoiding flicker. The token cost scales with tools *used*, not tools *available*.
- **Safe wrappers swallow failures** — a misbehaving MCP server or expired Composio connection yields zero tools rather than failing the whole turn. Errors are logged server-side.
- **Per-call MCP connections** — the server's `withClient` connects, runs, and closes on every operation. MCP sessions are cheap (one POST handshake on Streamable HTTP), and per-call connections avoid stale-session state across Worker isolates.
- **Pending TTL** — a parked call that never gets resolved auto-rejects in 2 minutes, so a disconnected client can't hang a turn forever.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| Tool output byte cap | `truncate.ts:1` | 51200 (50 KB) | `MAX_OUTPUT_BYTES` |
| Tool output line cap | `truncate.ts:2` | 2000 | `MAX_OUTPUT_LINES` |
| Deferred-binding threshold | `tool-search.ts:5` | 12 | `DEFER_THRESHOLD` defer-marked tools |
| Search top-K | `tool-search.ts:6` | 8 | `SEARCH_TOP_K` per query |
| Name-match weight | `tool-search.ts:7` | 3 | `NAME_WEIGHT` vs desc weight 1 |
| Min token length | `tool-search.ts:8` | 2 | `MIN_TOKEN_LEN` for ranking |
| Pending call TTL | `pending-store.ts:3` | 120000 ms (2 min) | `PENDING_TTL_MS` |
| Anthropic tool cache | `registry.ts:25` | last tool only | `cacheLastToolDef`, set by cache policy |
