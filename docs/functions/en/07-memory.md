# Memory System

The memory system gives agents persistent, searchable knowledge bases. A `memory` is a named, ownable collection of atomic facts (`memory_items`), each with an embedding vector for kNN retrieval. Memories are assigned to agents (web or local/bridge) many-to-many with a per-link role (`read` | `read_write`). The web UI manages memories and items; a Memory MCP server exposes `memory_search` / `memory_add` tools to bridge-connected local agents.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web (browser)                                             │
│    /memories          MemoryList (table) + CreateMemoryDialog    │
│    /memories/$id      MemoryDetail + AddItemComposer + MemoryItems │
│    Agent/Local settings  MemoryPicker / AssignedMemories        │
└──────────────────────┬──────────────────────────────────────────┘
                       │  oRPC (Bearer JWT)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  packages/api — memoryRouter (userProcedure)                    │
│    createMemory / listMemories / getMemory / deleteMemory       │
│    addItem / listItems / deleteItem                             │
│    assignMemory / unassignMemory / listAssigned                 │
│    search (embed → kNN)                                         │
│  memory-support.ts: requireOwnedMemory, embedAndAddItem,         │
│    embedAndSearchItems, resolveTargetLinks, mutateAssignment     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
          ┌────────────┴─────────────┐
          ▼                          ▼
┌──────────────────────┐   ┌──────────────────────────────────────┐
│  packages/db          │   │  apps/server — Memory MCP            │
│  memory-store.ts      │   │  /mcp/memory (Hono sub-app)           │
│  memory-item-store.ts │   │  bridge-token auth (bt_ → hash lookup)│
│                       │   │  tools: memory_search, memory_add     │
│  schema/memory.ts:    │   │  role gating: add needs read_write    │
│  memories             │   └──────────────────────┬───────────────┘
│  agent_memories       │                          │
│  bridge_token_memories│                          │
│  memory_items         │   ┌──────────────────────▼───────────────┐
│  memory_embeddings     │   │  EmbeddingClient (SiliconFlow         │
│  (pgvector HNSW)      │   │  BAAI/bge-m3, 1024 dims)              │
└──────────────────────┘   └───────────────────────────────────────┘
```

### Memory storage

The schema (`packages/db/src/schema/memory.ts`) has five tables:

- **`memories`** (`memory.ts:28`) — the named knowledge base: `id`, `userId` (owner), `name`, `description`, timestamps. Indexed on `userId`.
- **`agent_memories`** (`memory.ts:51`) — many-to-many link for **web agents**: `agentId` (FK to `agents`), `memoryId`, `role` (`read` | `read_write`, default `read`). Primary key on `(agentId, memoryId)`.
- **`bridge_token_memories`** (`memory.ts:72`) — the parallel link for **local/bridge agents**, keyed to `tokenId` (FK to `bridge_tokens`) instead of `agentId`. Same shape: `tokenId`, `memoryId`, `role`. This means a local agent gets memory the same many-to-many, role-scoped way a web agent does.
- **`memory_items`** (`memory.ts:92`) — the atomic facts: `content`, `source` (`user` | `extracted` | `reflection`, default `user`), `importance` (0–1, default 0.5), `validFrom`/`validTo` (soft-delete watermark — `null` = current), `lastAccessedAt`, `metadata` (jsonb). Partial index `memory_items_memory_id_current_idx` on `(memoryId) WHERE validTo IS NULL` backs the hot read path.
- **`memory_embeddings`** (`memory.ts:124`) — one embedding per item, split from `memory_items` so re-embedding / model A-B tests never rewrite the facts. `embedding` is a `vector(1024)` (SiliconFlow `BAAI/bge-m3` width), `model` records the producing model. HNSW index with `vector_cosine_ops` for kNN retrieval.

### Memory assignment

Assignment is many-to-many with a role. A memory can be shared across multiple agents; each agent is `read` by default unless explicitly granted `read_write`. `resolveTargetLinks` (`memory-support.ts:207`) asserts the caller owns the targeted agent/token, then returns its memory links. `mutateAssignment` (`memory-support.ts:227`) asserts ownership of both the memory and the target before linking/unlinking. `assertOneTarget` (`memory-support.ts:172`) enforces exactly one of `agentId`/`tokenId` per call.

The `MemoryStore` (`packages/db/src/repositories/memory-store.ts:148`) provides `assignAgent`/`unassignAgent`/`listAgentMemories` (web agents) and `assignToken`/`unassignToken`/`listTokenMemories` (local agents) — both as upserts on conflict (`onConflictDoUpdate` sets the role). `deleteWithChildren` (`memory-store.ts:104`) cascades in one transaction: embeddings → items → agent links → token links → memory (owner-scoped, so a non-owner's call removes nothing).

### Memory management UI

- **List page** (`/memories`, `memories.index.tsx`) — `MemoryList` (`memory-list.tsx:25`) renders a `MemoryTable` of the user's memories; `CreateMemoryDialog` (`create-memory-dialog.tsx:160`) creates a named KB and navigates to its detail page.
- **Detail page** (`/memories/$memoryId`, `memories.$memoryId.tsx`) — `MemoryDetail` (`memory-detail.tsx:36`) shows the memory's name/description, an `AddItemComposer` (`add-item-composer.tsx:84`) for adding facts (with optional 0–1 importance), and `MemoryItems` listing current items (soft-deletable).
- **Memory picker** (`memory-picker.tsx:41`) — a multi-select checkbox list of the user's memories, used in agent creation flows. Selections become `read`-role assignments once the agent exists (`assign-memories.ts:8` `assignMemoriesTo`).
- **Assigned memories** (`assigned-memories.tsx:140`) — shown in agent/local-agent settings: lists assigned memories with a role toggle (read ⇄ read & write, via re-assign upsert) and unassign, plus one-click assignment of remaining memories. Used by `LocalAgentSettingsDialog`'s Memories tab.

### Memory MCP

The Memory MCP server (`apps/server/src/memory-mcp.ts`) is an in-process Hono sub-app mounted at `/mcp/memory` (`app.ts:219`), registered **before** the oRPC catch-all so requests terminate here with bridge-token auth instead of paying an oRPC dispatch. It exposes two tools to bridge-connected local agents:

- **`memory_search`** (`memory-mcp-tools.ts:127` `runSearch`) — embeds the query, searches across **all** memories assigned to the token (`listTokenMemories`), returns up to `k` items (default 5, max 20). Each result formatted as `[memoryName] (importance N) content`.
- **`memory_add`** (`memory-mcp-tools.ts:210` `runAdd`) — writes a fact to a **writable** memory. `resolveWritable` (`memory-mcp-tools.ts:170`) picks the target: the single `read_write` link if exactly one, else the one matching `memory_name`; every other case returns an actionable error listing writable options. Items added with `source: "extracted"` (`'user'` reserved for human-curated web entries).

**Auth: bridge token as principal** (`memory-mcp.ts:127` `resolveTokenId`). The Bearer credential is the agent's `bt_…` token. `resolveTokenId` hashes it (same `hashToken` as the bridge plane) and looks it up via `bridgeToken.findByHash`; a missing or revoked token returns 401. The resolved `tokenId` **is** the principal — it resolves to assigned memories via `bridge_token_memories`, exactly like the bridge relay plane. No separate auth table.

**Role gating**: `memory_search` reads across all assigned memories (any role); `memory_add` writes only through a `read_write` link — a token with only `read` links gets an actionable error: "This agent has no writable memory. Ask the owner to assign one with the read_write role."

Both the web router and the MCP tools flow through the same shared embed chokepoints (`embedAndAddItem` / `embedAndSearchItems` in `memory-support.ts`), so the model recorded beside the vector never diverges between the two entry points, and the char-limit guard (`MAX_EMBED_CHARS=8000`) applies to both.

## Key Files

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema/memory.ts` | `memories`, `agent_memories`, `bridge_token_memories`, `memory_items`, `memory_embeddings` tables |
| `packages/db/src/repositories/memory-store.ts` | `createMemoryStore`: CRUD, agent/token link ops, cascade delete |
| `packages/db/src/repositories/memory-item-store.ts` | `createMemoryItemStore`: add (item+embedding tx), listCurrent, softDelete, kNN search |
| `packages/api/src/routers/memory.ts` | `memoryRouter`: create/list/get/delete memory, add/list/delete items, assign/unassign/listAssigned, search |
| `packages/api/src/routers/memory-support.ts` | `requireOwnedMemory`, `embedAndAddItem`, `embedAndSearchItems`, `resolveTargetLinks`, `mutateAssignment`, input schemas |
| `packages/agent/src/memory-ports.ts` | `MemoryStore`, `MemoryItemStore`, `EmbeddingClient`, `MemoryRow`, `MemoryItemRow`, `MemoryRole`, `MemoryItemSource` port types |
| `apps/web/src/components/memory/memory-list.tsx` | `MemoryList`: table + delete |
| `apps/web/src/components/memory/memory-detail.tsx` | `MemoryDetail`: name/desc + AddItemComposer + MemoryItems |
| `apps/web/src/components/memory/create-memory-dialog.tsx` | `CreateMemoryDialog`: name + description → navigate to detail |
| `apps/web/src/components/memory/add-item-composer.tsx` | `AddItemComposer`: content + optional importance (0–1) |
| `apps/web/src/components/memory/memory-picker.tsx` | `MemoryPicker`: multi-select checkbox list for agent creation |
| `apps/web/src/components/memory/assign-memories.ts` | `assignMemoriesTo` / `assignMemoriesSafely`: post-creation assignment |
| `apps/web/src/components/memory/assigned-memories.tsx` | `AssignedMemories`: role toggle + unassign + one-click assign |
| `apps/web/src/routes/memories.index.tsx` | `/memories` route: list + create dialog |
| `apps/web/src/routes/memories.$memoryId.tsx` | `/memories/$memoryId` route: detail page |
| `apps/server/src/memory-mcp.ts` | `buildMemoryMcpApp`: Hono sub-app, bridge-token auth, JSON-RPC dispatch |
| `apps/server/src/memory-mcp-tools.ts` | `MEMORY_TOOLS`, `runSearch`, `runAdd`, `resolveWritable`, `MemoryMcpServices` |
| `apps/server/src/app.ts:219` | Mount point: `app.route("/mcp/memory", buildMemoryMcpApp(services))` |

## Data Flow

### Create memory + add item (web)

```
CreateMemoryDialog → orpc.memory.createMemory({name, description})
  → memoryStore.create({userId, name, description}) → memories row
  → navigate to /memories/$memoryId
AddItemComposer → orpc.memory.addItem({memoryId, content, importance?})
  → requireOwnedMemory (NOT_FOUND if missing/other-owner)
  → embedAndAddItem(embeddingClient, memoryItemStore, {…})
    → assertEmbedTextWithinLimit (8000 chars)
    → embedText(client, content) → SiliconFlow BAAI/bge-m3 → 1024-dim vector
    → memoryItemStore.add: transaction(insert memory_items + insert memory_embeddings)
  → invalidate listItems query
```

### Assign memory to agent/local-agent

```
AssignedMemories → orpc.memory.assignMemory({agentId|tokenId, memoryId, role})
  → mutateAssignment(context, userId, input, "assign")
    → assertOneTarget (exactly one of agentId/tokenId)
    → requireOwnedMemory (caller owns the memory)
    → assertOwnedAgent OR assertOwnedToken (caller owns the target)
    → memoryStore.assignAgent({agentId, memoryId, role}) (upsert)
      OR memoryStore.assignToken({tokenId, memoryId, role}) (upsert)
  → invalidate listAssigned query
```

### Search (web)

```
orpc.memory.search({agentId|tokenId, query, k?})
  → resolveTargetLinks(context, userId, input) → links [{memoryId, role}]
  → if no memories: return []
  → embedAndSearchItems(embeddingClient, memoryItemStore, {query, memoryIds, k})
    → embedText(client, query)
    → memoryItemStore.search: kNN over current items (validTo IS NULL)
      ORDER BY cosineDistance(embedding, $query) LIMIT k
      (uses HNSW vector_cosine_ops index)
    → bump lastAccessedAt on returned items
```

### Memory MCP (local agent)

```
Agent calls /mcp/memory (POST, Bearer bt_…)
  → resolveTokenId: hashToken → bridgeToken.findByHash → tokenId (401 if invalid/revoked)
  → handleMemoryMcpMessage:
    → initialize → protocolVersion, capabilities, serverInfo
    → tools/list → MEMORY_TOOLS [memory_search, memory_add]
    → tools/call:
      → memory_search:
        → listTokenMemories(tokenId) → links
        → if empty: "No memories are assigned to this agent."
        → embedAndSearchItems(client, memoryItem, {query, memoryIds, k})
        → format: [memoryName] (importance N) content
      → memory_add:
        → resolveWritable(tokenId, memory_name?) → {memoryId, name} | {error}
          → listTokenMemories → filter role==="read_write"
          → if 0: "no writable memory" error
          → if 1 (no name) or name matches: target
          → if >1 (no name): "pass memory_name" error
        → embedAndAddItem(client, memoryItem, {memoryId, content, source:"extracted"})
        → "Saved to memory 'name' (item id)"
```

## Design Rationale

- **Embeddings split from facts** (`memory_embeddings` separate from `memory_items`) — re-embedding or switching models never rewrites the fact rows; only the embedding column is model-bound. A/B testing models is non-destructive.
- **Soft-delete via `validTo`** — items are never hard-deleted from the DB; `validTo` is set to `now()`, dropping them from the current set and the kNN candidate set (the partial index `WHERE validTo IS NULL`). Recoverable, auditable.
- **Many-to-many with role** — one knowledge base shared across agents, each with independent `read`/`read_write`. A shared "project conventions" memory can be read-only for most agents but writable for one.
- **Two link tables (agent + token)** — web agents and local/bridge agents key off different FKs (`agents.id` vs `bridge_tokens.id`), but the shape is identical. A local agent gets memory the same way a web agent does; the API and UI reuse the same patterns.
- **Ownership-checked, ownership-hidden** — `requireOwnedMemory` returns `NOT_FOUND` for both missing and other-owner memories, so ownership never leaks through error differentiation.
- **Bridge token as MCP principal** — local agents already hold a `bt_…` token; reusing it as the MCP bearer means zero new auth surface. The token resolves to the same memory links the bridge plane uses, keeping one source of truth.
- **Shared embed chokepoints** — both the web router and MCP tools call `embedAndAddItem`/`embedAndSearchItems`, so the char limit, error sanitization (provider internals never echoed to the caller — `SERVICE_UNAVAILABLE`), and model recording are applied uniformly.
- **`source` distinguishes provenance** — `user` (web UI curated), `extracted` (agent-authored via MCP), `reflection` (future auto-capture phase). Web entries stay reserved for human-curated; MCP-added items are stamped `extracted`.
- **Default importance 0.5** — a curated fact carries no learned salience yet; mid-scale is the neutral start.
- **kNN over HNSW cosine** — pgvector's HNSW index with `vector_cosine_ops` gives approximate kNN retrieval; `cosineDistance` in the query builder ensures the index is used.
- **Actionable write errors** — `resolveWritable` never silently fails: it lists the writable options by name, telling the agent exactly what to pass as `memory_name`.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| Embedding dimensions | `schema/memory.ts:22` `EMBEDDING_DIMENSIONS` | 1024 | SiliconFlow `BAAI/bge-m3` output width |
| Embedding model | `EmbeddingClient.model` | `BAAI/bge-m3` | SiliconFlow OpenAI-compatible API |
| Default importance | `schema/memory.ts:24` `DEFAULT_IMPORTANCE` | 0.5 | neutral mid-scale start |
| Importance range | `memory-support.ts:19-20` | 0–1 | `MIN_IMPORTANCE` / `MAX_IMPORTANCE` |
| Max embed chars | `memory-support.ts:24` `MAX_EMBED_CHARS` | 8000 | caps cost/DoS at shared embed chokepoint |
| Default search k | `memory-support.ts:17` `DEFAULT_SEARCH_K` | 5 | web search default |
| Max search k (web) | `memory-support.ts:18` `MAX_SEARCH_K` | 50 | web search ceiling |
| MCP default k | `memory-mcp-tools.ts:20` `DEFAULT_K` | 5 | MCP `memory_search` default |
| MCP max k | `memory-mcp-tools.ts:21` `MAX_K` | 20 | MCP `memory_search` ceiling (clamped via `clampK`) |
| Memory role | `memory-ports.ts:12` `MemoryRole` | `read` | `read` | `read_write` |
| Memory item source | `memory-ports.ts:16` `MemoryItemSource` | `user` | `user` | `extracted` | `reflection` |
| MCP protocol version | `memory-mcp.ts:21` | `2025-06-18` | `MEMORY_MCP_PROTOCOL_VERSION` |
| MCP server info | `memory-mcp.ts:22` | `{ name: "better-agent-memory", version: "0.1.0" }` | `MEMORY_MCP_SERVER_INFO` |
| MCP mount point | `apps/server/src/app.ts:219` | `/mcp/memory` | registered before oRPC catch-all |
| HNSW index | `schema/memory.ts:136` | `vector_cosine_ops` | kNN retrieval via cosine distance |
| Partial index | `schema/memory.ts:116` | `WHERE validTo IS NULL` | hot read path (current items) |
