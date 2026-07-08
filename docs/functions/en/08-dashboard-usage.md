# Dashboard & Usage

The Token Tracking dashboard (`/dashboard`) visualizes a user's token consumption and cost across both the chat agent runtime and bridge-connected local agents. Four stat tiles, a dual-axis area chart, a GitHub-style activity heatmap, and a per-agent-kind breakdown render over two usage APIs — `usage.summary` (chat tokens/cost from assistant messages) and `bridge.usageByAgentKind` (local agent usage from persisted `turn_usage` events). A unified `usage_records` table is designed (WIP) to replace the two-source aggregation with a single ledger.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web — /dashboard                                          │
│    DashboardPage (windowDays state: 3 | 7 | 12)                  │
│    ┌─────────────────────────────────────────────┐               │
│    │ StatsPanel (4 tiles: cost, tokens, turns, $/turn) │         │
│    │ TokenChart (AreaChart: input+output areas + cost line) │     │
│    │ ActivityHeatmap (GitHub-style 5-level grid) │               │
│    └─────────────────────────────────────────────┘               │
│    ┌─────────────────────────────────────────────┐               │
│    │ UsageOverview (per-agent-kind colored bars)  │              │
│    └─────────────────────────────────────────────┘               │
└───────────────┬──────────────────────┬──────────────────────────┘
                │                      │
    useUsageData                  useLocalAgentUsage
    (usage.summary)               (bridge.usageByAgentKind)
                │                      │
                ▼                      ▼
┌──────────────────────────┐  ┌────────────────────────────────────┐
│  usageRouter (authorized │  │  bridgeRouter.usageByAgentKind       │
│  UserProcedure)          │  │  (userProcedure)                    │
│  summarizeUsage:         │  │  since = now - windowDays           │
│    dailySummary(userId,  │  │  bridgeUsage.usageByAgentKind(       │
│      since) → daily rows │  │    userId, since)                    │
│    + totals              │  │  → byKind: [{agentKind, costUsd, …}] │
└──────────┬───────────────┘  └──────────────┬─────────────────────┘
           │                                 │
           ▼                                 ▼
┌──────────────────────────┐  ┌────────────────────────────────────┐
│  UsageStore (db)         │  │  BridgeUsageStore (db)              │
│  SQL: SUM(messages.usage)│  │  SQL: SUM(bridge_messages.event     │
│  JOIN sessions (owner)   │  │    ->'detail'->>'costUsd')          │
│  GROUP BY day            │  │  JOIN bridge_sessions (owner)       │
│                          │  │  WHERE event->>'status'='turn_usage'│
│                          │  │  GROUP BY agent_kind                │
└──────────────────────────┘  └────────────────────────────────────┘

WIP: usage_records (unified ledger, dual-write plan)
```

### Token tracking dashboard

`DashboardPage` (`apps/web/src/routes/dashboard.tsx:76`) holds a `windowDays` state (`3` | `7` | `12`, default `7`), toggled by `WindowToggle`. `useUsageData` (`use-usage-data.ts:57`) queries `usage.summary` and builds a continuous day axis (`buildDayAxis`, zero-filling missing days via `mergeDays`) so the chart never has gaps. `useLocalAgentUsage` (`use-local-agent-usage.ts:27`) queries `bridge.usageByAgentKind` and zero-fills every agent kind (so the structure is always visible even when a kind has no usage).

The layout (`DashboardBody`, `dashboard.tsx:46`): a 2/3 column with `StatsPanel` + `TokenChart` + `ActivityHeatmap`, and a 1/3 column with `UsageOverview`. An `EmptyState` renders when the chat usage has no daily rows.

- **`StatsPanel`** (`stats-panel.tsx:52`) — four tiles in a responsive grid (2 cols mobile, 4 cols desktop): Total Cost (`$X.XX`), Total Tokens (K/M formatted), Turns, and Avg $/Turn. Each tile shows a pulse skeleton while pending.
- **`TokenChart`** (`token-chart.tsx:149`) — a Recharts `AreaChart` with two stacked areas (Input, Output) on the left Y-axis (token count, k-formatted ticks) and a Cost `Line` on the right Y-axis ($-formatted, green). Gradient fills (`<linearGradient>`) fade each area from 30% opacity at top to 0% at bottom. A 12-bar skeleton renders while pending. Tooltip uses theme variables (`--popover`, `--border`).
- **`ActivityHeatmap`** (`activity-heatmap.tsx:204`) — a GitHub-style 5-level intensity grid. `buildWeeks` (`activity-heatmap.tsx:54`) groups daily turns into weeks (Mon-start), `intensityLevel` (`activity-heatmap.tsx:37`) maps turns/max ratio to 0–4. Light/dark palettes (`LEVELS_LIGHT`/`LEVELS_DARK`) detected via `document.documentElement.classList.contains("dark")`. Hover tooltip shows date + turn count. Legend: "Less ▢▢▢▢▢ More".
- **`UsageOverview`** (`usage-overview.tsx:127`) — per-agent-kind colored progress bars. Rows sorted by cost (desc); each shows the agent kind icon, label, total tokens, cost, a colored bar (width = cost/maxCost), and "% of cost · N turns". Colors: claude `#d97757`, codex `#3b82f6`, opencode `#f59e0b`, pi `#a78bfa`. Skeleton while pending; empty hint when no local agent usage.

### Usage API

**`usage.summary`** (`packages/api/src/routers/usage.ts:48`) — `authorizedUserProcedure` (user + invite gate). Takes `windowDays` (3/7/12), computes `since = now - windowDays * 86400000`, calls `UsageStore.dailySummary(userId, since)`, and reduces daily rows into totals (costCents, inputTokens, outputTokens, turns). The daily rows are sparse (only days with usage); the web's `mergeDays` zero-fills them onto the continuous axis.

**`bridge.usageByAgentKind`** (`packages/api/src/routers/bridge-usage.ts:10`) — `userProcedure`. Same rolling window. Calls `BridgeUsageStore.usageByAgentKind(userId, since)`, returning `{ windowDays, byKind: [{agentKind, costUsd, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, turns}] }`. Only kinds with a persisted `turn_usage` event in the window appear; the web zero-fills the rest via `AGENT_KIND_OPTIONS`.

### Usage records (WIP)

A unified `usage_records` table (`packages/db/src/schema/usage.ts:26`) is designed to be the single source of truth for usage statistics, replacing the two-source aggregation (chat from `messages.usage` JSONB, bridge from `bridge_messages.event` JSONB). Design:

- **`source`**: `"chat" | "bridge"` — both the chat agent runtime and the local-agent bridge write here.
- **`dedupKey`**: unique — chat rows use `chat:<messageId>`, bridge rows use `bridge:<sessionId>:<seq>`. An upsert on conflict keeps re-finalizes / replays from double-counting (`uniqueIndex("usage_records_dedup_key_idx")`).
- **`agentKind`**: null for chat (chat has no agentKind; its `providerId`/`modelId` are below), set for bridge.
- **`costUsd`**: numeric (USD, not cents — the bridge side was already USD; chat's cents divided by 100 on write). Null when `priced` is false (no pricing was known, so the UI shows "unknown" instead of a silent $0).
- **Token buckets**: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`.
- **Indexes**: dedup key (unique), `(userId, bucketedAt)`, `(userId, agentKind)`, `sessionId`, `(providerId, modelId)`.

The **dual-write plan**: both sources write to `usage_records` (upsert on `dedupKey`) while the dashboard reads from it, allowing a migration off the two JSONB-aggregation queries. See `docs/usage-stats-plan.md` / `docs/usage-stats-impl-plan.md` for the full design.

### No-raw-SQL enforcement

`scripts/check-no-raw-sql.js` is a pre-commit guard (wired in `lefthook.yml:20`) that scans staged `.ts`/`.tsx` files under `packages/db/` for the `sql\`…\`` tag template — drizzle's raw-SQL escape hatch. Any match fails the commit with a message pointing at the builder APIs (`db.insert().values()`, `db.select().from().where()`, `.onConflictDoUpdate()`). Comment lines are skipped; `sql.raw()` / `sql.identifier()` (no backtick) are unaffected.

The two usage stores (`usage-store.ts`, `bridge-usage-store.ts`) currently use `db.execute(sql\`...\`)` for their aggregation queries — these are the **exceptions** that predate/exist alongside the guard. The `usage_records` WIP table is part of the plan to replace them with normalized columns + builder queries, so the DB layer stays fully builder-based and driver-portable.

## Key Files

| File | Responsibility |
|------|----------------|
| `apps/web/src/routes/dashboard.tsx` | `DashboardPage`: windowDays state, header, body layout, error toast |
| `apps/web/src/components/dashboard/stats-panel.tsx` | `StatsPanel`: 4 tiles (cost, tokens, turns, $/turn), K/M formatting |
| `apps/web/src/components/dashboard/token-chart.tsx` | `TokenChart`: Recharts AreaChart, gradient fills, dual Y-axis, skeleton |
| `apps/web/src/components/dashboard/activity-heatmap.tsx` | `ActivityHeatmap`: GitHub-style 5-level grid, week builder, hover tooltip |
| `apps/web/src/components/dashboard/usage-overview.tsx` | `UsageOverview`: per-agent-kind colored progress bars |
| `apps/web/src/components/dashboard/use-usage-data.ts` | `useUsageData`: usage.summary query + continuous day axis + zero-fill |
| `apps/web/src/components/dashboard/use-local-agent-usage.ts` | `useLocalAgentUsage`: bridge.usageByAgentKind + zero-fill all kinds |
| `apps/web/src/components/dashboard/dashboard-constants.ts` | `WINDOW_OPTIONS` (3/7/12), `DEFAULT_WINDOW` (7), chart colors, `CENTS_PER_DOLLAR` |
| `apps/web/src/components/dashboard/window-toggle.tsx` | `WindowToggle`: 3D / 7D / 12D segmented control |
| `apps/web/src/components/dashboard/empty-state.tsx` | `EmptyState`: "No usage yet" with BarChart2 icon |
| `apps/web/src/components/dashboard/summary-card.tsx` | `SummaryCard`: icon + label + value tile (skeleton while pending) |
| `packages/api/src/routers/usage.ts` | `usageRouter.summary` + `summarizeUsage` (authorizedUserProcedure) |
| `packages/api/src/routers/bridge-usage.ts` | `usageByAgentKind` (userProcedure) |
| `packages/db/src/repositories/usage-store.ts` | `createUsageStore`: `dailySummary` (SQL aggregation over messages.usage) |
| `packages/db/src/repositories/bridge-usage-store.ts` | `createBridgeUsageStore`: `usageByAgentKind` (SQL over bridge_messages JSONB) |
| `packages/db/src/schema/usage.ts` | `usage_records` table (WIP unified ledger) |
| `scripts/check-no-raw-sql.js` | Pre-commit guard: rejects `sql\`…\`` in packages/db/ |

## Data Flow

### Chat usage (dashboard load)

```
DashboardPage → useUsageData(windowDays)
  → orpc.usage.summary({ windowDays })
    → authorizedUserProcedure (user + invite gate)
    → summarizeUsage(usageStore, userId, windowDays)
      → since = now - windowDays * 86400000
      → usageStore.dailySummary(userId, since)
        → SQL: SUM(messages.usage->>'inputTokens'/'outputTokens'/'costCents')
          JOIN sessions ON sessions.id = messages.sessionId
          WHERE sessions.userId = userId AND role='assistant'
            AND usage IS NOT NULL AND createdAt >= since
          GROUP BY to_char(date_trunc('day', createdAt), 'YYYY-MM-DD')
      → totals = daily.reduce(sum, EMPTY_TOTALS)
      → { windowDays, daily, totals }
  → buildDayAxis(windowDays) → continuous YYYY-MM-DD array
  → mergeDays(axis, raw.daily) → zero-filled DayPoint[]
  → StatsPanel / TokenChart / ActivityHeatmap render
```

### Local agent usage

```
UsageOverview → useLocalAgentUsage(windowDays)
  → orpc.bridge.usageByAgentKind({ windowDays })
    → userProcedure
    → bridgeUsage.usageByAgentKind(userId, since)
      → SQL: SUM(event->'detail'->>'costUsd')
        SUM(event->'detail'->'usage'->>'input_tokens'/'output_tokens'/…)
        JOIN bridge_sessions ON bridge_sessions.id = bridge_messages.sessionId
        WHERE bridge_sessions.userId = userId
          AND event->>'status' = 'turn_usage'
          AND bridge_messages.createdAt >= since
        GROUP BY bridge_sessions.agent_kind
    → { windowDays, byKind: [...] }
  → zeroRow(kind) for every kind in AGENT_KIND_OPTIONS not present
  → sort by costUsd desc → AgentRow (icon, label, tokens, cost, bar, %)
```

### WIP: unified usage_records (dual-write, planned)

```
Chat turn completes:
  → assistant message persisted with usage JSONB
  → (planned) upsert usage_records { dedupKey: "chat:<messageId>",
      source: "chat", userId, sessionId, providerId, modelId,
      inputTokens, outputTokens, costUsd, priced }
Bridge turn completes:
  → turn_usage event persisted to bridge_messages
  → (planned) upsert usage_records { dedupKey: "bridge:<sessionId>:<seq>",
      source: "bridge", userId, sessionId, agentKind,
      inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
      costUsd, priced }
Dashboard reads:
  → (planned) single query over usage_records
    GROUP BY date_trunc('day', bucketedAt) and/or agentKind
    (replaces the two JSONB-aggregation queries)
```

## Design Rationale

- **Two sources, one dashboard** — chat usage lives in `messages.usage` (JSONB on assistant messages); bridge usage lives in `bridge_messages.event` (JSONB `turn_usage` status events). The dashboard queries both and renders them side-by-side rather than forcing a migration before shipping.
- **Continuous day axis** — `buildDayAxis` + `mergeDays` zero-fills missing days so the chart and heatmap never have gaps, even if a user had no usage on a given day. The API returns sparse rows (only days with usage); the web fills the structure.
- **Zero-filled agent kinds** — `useLocalAgentUsage` zero-fills every `AGENT_KIND_OPTIONS` kind, so the UsageOverview always shows the full structure (all four agent kinds) even when only one has usage. `isEmpty` is true only when NO kind has any usage.
- **Cents vs USD** — chat usage is stored in cents (integer-friendly); bridge `turn_usage` carries `costUsd` (float). The dashboard normalizes: `StatsPanel` divides cents by `CENTS_PER_DOLLAR=100`; `UsageOverview` uses bridge's USD directly. The WIP `usage_records` table stores USD (normalizing on write) to unify this.
- **`priced` flag** — `usage_records.priced` is false when no pricing was known, so the UI can show "unknown" instead of a silent `$0` that misleads the user into thinking usage was free.
- **Dual-axis chart** — tokens (left Y, k-formatted) and cost (right Y, $-formatted, green) share an X-axis but have independent scales, so a high-token-low-cost day and a low-token-high-cost day are both readable.
- **GitHub-style heatmap** — turns-per-day as a 5-level intensity grid is immediately scannable for usage patterns (streaks, gaps). Light/dark palette detection keeps it legible in both themes.
- **`turn_usage` as bridge usage source** — the claude-code normalize layer emits a `turn_usage` status event per completed turn with `costUsd`/`numTurns`/`usage`. Persisting it to `bridge_messages` (best-effort during relay) means usage is recoverable even if the relay store rolls the event out of its window.
- **Snake_case in raw usage** — claude's SDK `usage` object uses snake_case (`input_tokens`, `cache_read_input_tokens`); the bridge-usage SQL reads these JSONB paths directly. The `parseUsageTokens` function in `bridge-session-status.ts` documents this: reading camelCase left every token bucket permanently undefined.
- **No-raw-SQL guard** — the pre-commit hook enforces builder-based DB access so the layer stays driver-portable (node-postgres + PGlite) and SQL-injection-proof. The usage stores' `db.execute(sql\`…\`)` aggregations are the documented exceptions; `usage_records` is the plan to replace them.
- **`authorizedUserProcedure` for chat usage** — chat usage requires the invite gate (a customer without a redeemed invite can't see the dashboard); bridge usage uses plain `userProcedure` (local agent usage is available to any signed-in user, since bridge tokens are user-scoped regardless of invite status).

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| Window options | `dashboard-constants.ts:4` `WINDOW_OPTIONS` | `[3, 7, 12]` | days; zod-validated `z.union([z.literal(3), z.literal(7), z.literal(12)])` |
| Default window | `dashboard-constants.ts:7` `DEFAULT_WINDOW` | 7 | initial `windowDays` state |
| Cents per dollar | `dashboard-constants.ts:10` `CENTS_PER_DOLLAR` | 100 | cost display normalization |
| Chart color (input) | `dashboard-constants.ts:13` `COLOR_INPUT` | `#6366f1` (indigo) | AreaChart input area |
| Chart color (output) | `dashboard-constants.ts:16` `COLOR_OUTPUT` | `#f59e0b` (amber) | AreaChart output area |
| Chart color (cost) | `dashboard-constants.ts:19` `COLOR_COST` | `#10b981` (green) | cost Line + right Y-axis |
| Chart height | `token-chart.tsx:23` `CHART_HEIGHT` | 280 | pixels |
| Area fill opacity | `token-chart.tsx:26` `AREA_FILL_OPACITY` | 0.15 | area fill (gradient adds 0.3→0) |
| Heatmap cell size | `activity-heatmap.tsx:8` `CELL_SIZE` | 13 | pixels |
| Heatmap cell gap | `activity-heatmap.tsx:9` `CELL_GAP` | 3 | pixels |
| Heatmap light palette | `activity-heatmap.tsx:6` `LEVELS_LIGHT` | `#ebedf0 → #10b981` | 5 levels (ebedf0, a7f3d0, 6ee7b7, 34d399, 10b981) |
| Heatmap dark palette | `activity-heatmap.tsx:7` `LEVELS_DARK` | `#30363d → #34d399` | 5 levels |
| Agent kind colors | `usage-overview.tsx:18` `KIND_COLORS` | claude `#d97757`, codex `#3b82f6`, opencode `#f59e0b`, pi `#a78bfa` | progress bars |
| Stale time | `apps/web/src/utils/orpc.ts:17` `STALE_TIME_MS` | 60000 (60s) | TanStack Query default |
| MS per day | `usage.ts:5` / `bridge-usage.ts:4` | 86400000 | window calculation |
| Usage records dedup | `schema/usage.ts:58` | `uniqueIndex` on `dedupKey` | upsert target (WIP) |
| Usage records TTL indexes | `schema/usage.ts:59-65` | `(userId, bucketedAt)`, `(userId, agentKind)`, `sessionId`, `(providerId, modelId)` | query paths |
| No-raw-SQL pattern | `scripts/check-no-raw-sql.js:21` | `/\bsql\s*\`/` | matches `sql\`…\`` tag template |
| No-raw-SQL scope | `scripts/check-no-raw-sql.js:62` | `packages/db/` `.ts`/`.tsx` | staged files only |
