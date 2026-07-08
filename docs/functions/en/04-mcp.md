# MCP Integration

better-agent integrates the Model Context Protocol in three distinct shapes: **user-registered remote MCP servers** (any user adds a URL + bearer token and links it to an agent), a **first-party MCP Worker** (`apps/mcp/`, a stateless JSON-RPC endpoint exposing X/Twitter tools), and an **in-process Memory MCP server** (`apps/server/src/memory-mcp.ts`, giving bridge-connected local agents `memory_search` / `memory_add`). All three are reached at runtime through the same `McpService` → `ToolDef` path.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Runtime turn                                               │
│    assembleAgentToolDefs → safeMcpDefs → buildMcpToolDefs   │
│      → McpService.listTools() / execute()                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼───────────────────────┐
        ▼                  ▼                       ▼
  User MCP servers   First-party MCP Worker   Memory MCP server
  (buildMcpResolver) (apps/mcp, CF Worker)    (/mcp/memory, in-process)
  Streamable HTTP    Streamable HTTP          Streamable HTTP
  bearer auth        bearer = X auth_token    bearer = bridge token
```

The common abstraction is `McpService` (`packages/agent/src/tool/mcp-tools.ts:10`):

```ts
interface McpService {
  execute(input: { toolName: string; args: unknown }): Promise<ExecuteResult>;
  listTools(): Promise<McpToolMeta[]>;
}
```

`buildMcpToolDefs` (`mcp-tools.ts:16`) turns a `McpService` into `ToolDef[]`, and `assembleAgentToolDefs` marks them all `defer: true` so they live behind `search_tools` past the threshold.

## Key Files

| File | Responsibility |
|------|----------------|
| `apps/server/src/mcp.ts` | `buildMcpResolver` — user-server connection, CF 1042 binding, per-call `withClient` |
| `packages/api/src/routers/mcp.ts` | `mcpRouter` — list/create/delete servers, tools diagnostic, ownership checks |
| `packages/db/src/schema/mcp.ts` | `mcpServers` table |
| `packages/db/src/repositories/mcp-server-store.ts` | `createMcpServerStore` — encrypted auth header, masked listing |
| `packages/agent/src/tool/mcp-tools.ts` | `McpService` interface, `buildMcpToolDefs` |
| `apps/mcp/src/app.ts` | First-party MCP Worker Hono app (stateless JSON-RPC) |
| `apps/mcp/src/mcp-server.ts` | `handleMessage` — JSON-RPC dispatch, X tool execution |
| `apps/mcp/src/x-tool-defs.ts` | The 8 X tool definitions + `TOOL_NAMES` set |
| `apps/server/src/memory-mcp.ts` | Memory MCP sub-app, bridge-token auth, JSON-RPC |
| `apps/server/src/memory-mcp-tools.ts` | `memory_search` / `memory_add` defs + implementations |

## Data Flow

### User MCP Servers

**Registration** (`packages/api/src/routers/mcp.ts`). `createServer` (`mcp.ts:82`) takes `{ name, url, bearerToken? }`, stores the row via `McpServerStore.create`, then **validates immediately** by connecting and calling `listTools()` (`mcp.ts:61`). If the connection fails, the row is deleted and the error surfaces to the owner — a broken server is never silently persisted.

**Storage** (`packages/db/src/schema/mcp.ts`). The `mcpServers` table holds `id`, `userId` (FK to users), `name`, `url`, `authHeaderCipher` (the full `Bearer …` value, encrypted via the same `SecretBox` as provider keys), `authLast4` (masked), and timestamps. `McpServerStore.create` (`mcp-server-store.ts:51`) encrypts the header and stores the last 4 chars; `getAuthHeader` (`mcp-server-store.ts:47`) decrypts server-side; `listByUser` (`mcp-server-store.ts:35`) returns only masked rows.

**Ownership** is enforced by `requireOwnedMcpServer` (`mcp.ts:35`): a missing server **or** a server owned by another user both return `NOT_FOUND`, so ownership never leaks through error differentiation. Deletion cascades: `unlinkMcpServer` removes the server id from every agent that linked it (`mcp.ts:104`).

**Resolver pattern** (`apps/server/src/mcp.ts:158` `buildMcpResolver`). The server exposes a `(serverId) => Promise<McpService | null>` resolver. Given a stored id it:

1. Fetches the row (`store.getById`).
2. Decrypts the auth header (`store.getAuthHeader`).
3. Decides whether to route through a Cloudflare service binding (see below).
4. Returns `createMcpService(target)`.

**CF service binding for error 1042** (`mcp.ts:141`). Cloudflare blocks same-account Worker-to-Worker fetches over the public URL with error 1042. The resolver detects our own MCP worker by a hostname marker (`INTERNAL_MCP_HOST_MARKER = "better-agent-mcp"`, `mcp.ts:16`) and, if a `ServiceBinding` was supplied, swaps the transport's `fetch` for `bindingFetch(binding)` (`mcp.ts:137`), which invokes the bound Worker directly — the hostname in the URL is ignored, only the binding target matters.

**Per-call connections** (`mcp.ts:54` `withClient`). Each `listTools` / `execute` connects (`client.connect`), runs, and closes in `finally`. MCP sessions are cheap (a single POST handshake on Streamable HTTP), and per-call connections avoid stale-session state across Worker isolates. All operations are wrapped in a 45-second timeout (`MCP_TIMEOUT_MS`, `mcp.ts:11`) via `withTimeout`.

**Validation at registration** is the key UX property: the owner gets immediate feedback (wrong URL, bad token) instead of a silently broken server that only fails at turn time.

### First-Party MCP Worker (`apps/mcp/`)

A standalone Cloudflare Worker exposing X (Twitter) tools over Streamable HTTP in **stateless JSON mode**. Every POST carries one JSON-RPC message; the response is plain JSON (the spec allows this instead of an SSE stream). No session state is kept — the user's X `auth_token` rides on each request as the Bearer token.

**App layer** (`apps/mcp/src/app.ts:22` `buildApp`). A Hono app with one POST route: parse JSON (or return a `PARSE_ERROR`), extract the bearer token via `bearerToken` (`app.ts:14`), delegate to `handleMessage`, and return JSON (or `202` for notifications).

**JSON-RPC dispatch** (`apps/mcp/src/mcp-server.ts:170` `handleMessage`):

| Method | Behavior |
|--------|----------|
| `initialize` | Returns `protocolVersion` (`2025-06-18`, `mcp-server.ts:20`), `capabilities: { tools: {} }`, server info |
| `ping` | Returns empty result |
| `tools/list` | Returns the 8 `TOOLS` from `x-tool-defs.ts` |
| `tools/call` | Routes to `callTool` → `runTool` with throttling + friendly errors |
| `notifications/*` | Returns `null` (no response body, HTTP 202) |
| other | `METHOD_NOT_FOUND` (-32601) |

**The 8 X tools** (`apps/mcp/src/x-tool-defs.ts:26`): `x_search_users`, `x_search_tweets`, `x_user_tweets`, `x_user_replies`, `x_user_media`, `x_followers`, `x_following`, `x_tweet_thread`. The five handle-based tools (`x_user_tweets` … `x_following`) share an input schema factory `handleTool` (`x-tool-defs.ts:13`) taking `screen_name` + optional `limit`. `TOOL_NAMES` (`x-tool-defs.ts:95`) is the validation set for `tools/call`.

**Tool execution** (`mcp-server.ts:86` `runTool`) creates an X client from the bearer token, dispatches by name, and returns `toolText(JSON.stringify(...))`. `callTool` (`mcp-server.ts:134`) validates the tool name against `TOOL_NAMES`, requires a non-null `authToken` (else an actionable error message), wraps execution in `throttleX` (rate-limit handling), and converts `XAuthError` / `XRateLimitError` into human-readable messages via `friendlyError` (`mcp-server.ts:51`). Tool results are flattened: `contentToOutput`-style `toolText` produces `{ content: [{ type: "text", text }], isError }`.

### Memory MCP Server

An **in-process** MCP server mounted at `/mcp/memory` inside the main server app (not a separate Worker), giving bridge-connected local agents (claude-code, opencode, pi, codex) access to the memory system. It lives in `apps/server` because it needs the DB stores and embedding client.

**Auth: bridge token as principal** (`apps/server/src/memory-mcp.ts:127` `resolveTokenId`). The Bearer credential is the agent's bridge token (`bt_…`). `resolveTokenId` hashes it (same `hashToken` as the bridge plane) and looks it up via `bridgeToken.findByHash`; a missing or revoked token returns `401`. The resolved `tokenId` **is** the principal — it resolves to assigned memories via `bridge_token_memories`, exactly like the bridge relay plane. No separate auth table.

**App layer** (`memory-mcp.ts:146` `buildMemoryMcpApp`). A Hono sub-app: resolve token (401 if invalid), parse JSON (400 on parse error), delegate to `handleMemoryMcpMessage`, return JSON or 202.

**JSON-RPC dispatch** (`memory-mcp.ts:89`) mirrors the X worker: `initialize`, `ping`, `tools/list` (returns `MEMORY_TOOLS`), `tools/call` → `callTool`. Protocol version `2025-06-18`, server info `better-agent-memory`.

**The two tools** (`apps/server/src/memory-mcp-tools.ts:37` `MEMORY_TOOLS`):

- **`memory_search`** (`memory-mcp-tools.ts:127` `runSearch`) — embeds the query, searches across **all** memories assigned to the token (`listTokenMemories`), returns up to `k` items (default 5, max 20, clamped via `clampK`). Each result is formatted as `[memoryName] (importance N) content`.
- **`memory_add`** (`memory-mcp-tools.ts:210` `runAdd`) — writes a fact to a **writable** memory. `resolveWritable` (`memory-mcp-tools.ts:170`) picks the target: the single `read_write` link if exactly one, else the one matching `memory_name`; every other case returns an actionable error listing the writable options by name. Items are added with `source: "extracted"` (`memory-mcp-tools.ts:239`) — `'user'` is reserved for human-curated entries from the web UI.

Both tools require the embedding client to be configured (else a clear error), and both are scoped to the token: search reads across all assigned memories, add only writes through a `read_write` link.

## Design Rationale

- **One `McpService` interface, three implementations** — the runtime doesn't care whether an MCP tool is a user server, the first-party worker, or the in-process memory server. All produce `ToolDef[]` through the same `buildMcpToolDefs` and all get `defer: true`.
- **Stateless JSON mode everywhere** — each request is a self-contained POST with the credential in the header. This sidesteps session management entirely, which is essential on Workers where long-lived connections aren't viable and isolates are ephemeral.
- **Resolver pattern with binding awareness** — the resolver is the single place that decides transport routing (direct fetch vs service binding). The runtime and API see only `(serverId) => McpService`. The CF 1042 workaround is invisible above this layer.
- **Per-call MCP connections** — avoids stale-session state across isolates at the cost of a handshake per operation, which is cheap on Streamable HTTP.
- **Validate-on-create for user servers** — connecting and listing tools at registration time means the owner sees "bad token" immediately, not mid-turn. A failed validation rolls back the row.
- **Bridge token as memory principal** — local agents already hold a `bt_…` token; reusing it as the MCP bearer means zero new auth surface. The token resolves to the same memory links the bridge plane uses, keeping one source of truth.
- **Ownership-checked, ownership-hidden** — `requireOwnedMcpServer` returns `NOT_FOUND` for both missing and foreign-owned servers, preventing enumeration of other users' server ids.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| MCP operation timeout | `apps/server/src/mcp.ts:11` | 45000 ms (45 s) | `MCP_TIMEOUT_MS`, wraps all `withLog` calls |
| MCP protocol version | `apps/mcp/src/mcp-server.ts:20` | `2025-06-18` | `PROTOCOL_VERSION`, returned by `initialize` |
| Memory MCP protocol version | `apps/server/src/memory-mcp.ts:21` | `2025-06-18` | `MEMORY_MCP_PROTOCOL_VERSION` |
| Auth header storage | `packages/db/src/schema/mcp.ts:18` | `authHeaderCipher` + `authLast4` | encrypted via `SecretBox`, last 4 chars masked |
| Internal host marker | `apps/server/src/mcp.ts:16` | `better-agent-mcp` | triggers the CF service-binding path |
| MCP client identity | `apps/server/src/mcp.ts:12` | `{ name: "better-agent", version: "1.0.0" }` | `CLIENT_INFO`, sent on `initialize` |
| Memory search default k | `apps/server/src/memory-mcp-tools.ts:20` | 5 | `DEFAULT_K`, max 20 (`MAX_K`) |
| Memory importance range | `apps/server/src/memory-mcp-tools.ts:22` | 0–1 | clamped via `clampImportance` |
| MCP error detail cap | `packages/api/src/routers/mcp.ts:7` | 300 chars, depth 4 | `MAX_DETAIL_LEN` / `MAX_DETAIL_DEPTH` in `toMcpError` |

The Cloudflare `ServiceBinding` is injected at server wiring time (`buildMcpResolver(store, internalBinding?)`) and is only present in the Worker deployment — absent in Node/serverless runs, where same-account fetch restrictions don't apply.
