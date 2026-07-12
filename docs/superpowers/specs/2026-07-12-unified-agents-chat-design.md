# Unified Agents & Chat Design

**Date:** 2026-07-12
**Scope:** apps/web (PC + mobile), packages/ui

## Goal

Four user-facing changes, applied to both desktop and mobile web:

1. **One agents list page.** Cloud agents (`/agents`) and local agents (`/local-agents`) merge into a single page. Rows show a type label (Cloud Agent / Local Agent); everything else renders identically. The token cell adopts the local-agent presentation (quiet `…last4` chip → popover with copyable token).
2. **One chat page.** The cloud chat (`/chat`) and the local-agent terminal (`/local-agents/$tokenId`) merge into a single chat page with a shared shell (header, feed, composer). Per-type differences are allowed but confined to slots.
3. **No cards in tool rendering.** Every tool-call/tool-result renderer drops Card / card-like nested boxes in favor of the flat bridge style.
4. **Pinned composer.** The chat input is always visible at the bottom of the viewport — never requires scrolling to the bottom of the feed to reach it.

## Current state (from code survey)

- Both lists already share `ListToolbar`, `useListView`, `Pagination`, `EmptyState`, `DeleteConfirm`, and a desktop-table / mobile-card split.
  - Cloud: `routes/agents.index.tsx` → `components/agents/agents-card.tsx`. Data: `orpc.agents.list` + per-row `orpc.agents.getToken` (N+1). Columns: Name · Model · Token (14-char inline + copy) · Actions (Chat/Edit/Rotate/Delete). Rows don't navigate.
  - Local: `routes/local-agents.index.tsx` → `components/bridge/local-agent-list.tsx`. Data: `orpc.bridge.listTokens` + `orpc.bridge.listSessions` joined client-side by `deriveLocalAgentEntries`. Columns: Agent · Status · Sessions · Created · Token (`KeyRound …last4` chip → popover with full token + run command) · Delete. Name navigates to `/local-agents/$tokenId`.
- Both chats already share `MessageScroller*`, `ChatMessage`/`ChatBlock`, `PromptInput*`, `ChatRow`, `Reasoning`, `Response` from `@better-agent/ui`. Cloud renders through `packages/ui` `Conversation`; local reimplements the shell in `components/bridge/terminal*.tsx` over a different transport (`useChat`+`AgentClient` vs `useBridgeTerminal`+`BridgeTransport`).
- Composers in both are `shrink-0` flex siblings — but the local detail route wraps everything in an `overflow-auto` document (`routes/local-agents.$tokenId.tsx`), so its composer is NOT pinned to the viewport; you must scroll the page. Cloud chat fills the route height and is pinned.
- Tool rendering: only 3 real shadcn `Card` imports (`question-card.tsx`, `event-line.tsx` ApprovalLine, `local-agent-card-list.tsx`). Everything else is hand-rolled `rounded-xl border bg-card` boxes. Choke points: `genui/finance/primitives.tsx` `CardShell` (~35 renderers) + `FinTable`; `packages/ui/src/components/chat/tool.tsx` `PlainToolView` (default cloud tool renderer). Reference flat style: `components/bridge/bridge-tool-card.tsx` — `rounded-md border bg-muted/40 text-xs` container, `border-t` internal dividers, mono text, inline lucide status icons, no nested boxes.

## Design

### 1. Unified agents list (`/agents`)

**Row model.** New client-side discriminated union in `apps/web/src/components/agents/unified-agent-row.ts`:

```ts
type UnifiedAgentRow =
  | { type: "cloud"; agent: AgentRow }
  | { type: "local"; entry: LocalAgentEntry; sessionCount: number };
```

Common accessors (`rowId`, `rowName`, `rowSubtitle`, `rowCreatedAt`) live next to the type. Data comes from the three existing queries (`agents.list`, `bridge.listTokens`, `bridge.listSessions` with polling); local rows keep `deriveLocalAgentEntries`. Sort merged rows by `createdAt` desc.

**Columns (desktop).** Agent · Type · Status · Created · Token · Actions.

- *Agent*: identity block — cloud keeps `agentAvatar`, local keeps `AgentKindIcon`; name on top, subtitle below (cloud: `providerId/modelId` mono; local: kind label). Local name navigates to chat (see §2 route); cloud name navigates to `/chat?agentId=…`.
- *Type*: quiet badge, "Cloud Agent" / "Local Agent" (outline badge, no color noise).
- *Status*: local → existing `LocalAgentStatusChip`; cloud → `—`.
- *Created*: both have `createdAt`.
- *Token*: one `UnifiedTokenCell` modeled exactly on `LocalAgentTokenCell` (chip `KeyRound …last4` → popover with labeled copyable blocks). Local: token + run command, unchanged. Cloud: fetch `agents.getToken` lazily **when the popover opens** (kills the current N+1), show full token + copy; chip shows the key icon with `…····` until known, `…last4` after first open. Rotate stays in row actions.
- *Actions*: per type — cloud: Chat / Edit(wizard) / Rotate / Delete; local: Delete. One `UnifiedRowActions` component that branches.

**Mobile card.** Same identity block; meta row = type badge · status chip (local) · created; footer = token cell left, actions right. Reuses whichever of `agents-card-list.tsx` / `local-agent-card-list.tsx` is structurally closer (local one; it also currently uses shadcn Card — replace with the flat list-item style used elsewhere).

**Add flow.** Toolbar button + mobile FAB become a dropdown: "Cloud Agent" → existing `AgentWizard`; "Local Agent" → existing `AddLocalAgentDialog` content. Both dialogs unchanged internally.

**Search.** Matches name, provider/model (cloud), kind (local), and type label.

**Navigation.** Sidebar and mobile tab bar lose the "Local Agent" entry; "Agents" matches `/agents`, `/chat`, `/local-agents`. `routes/local-agents.index.tsx` becomes a redirect to `/agents`. `local-agent-list.tsx`, `local-agent-table.tsx`, `agents-card.tsx` list orchestration collapse into the merged components; delete dead code.

### 2. Unified chat page (`/chat`)

**Routing.** `/chat` search params become `{ agentId?: string; localAgentId?: string }` (exactly one). `routes/local-agents.$tokenId.tsx` becomes a redirect to `/chat?localAgentId=$tokenId` (keeps old links working). With neither param, `/chat` keeps the existing agent-grid picker, extended to show local agents too (same type badge).

**Shell.** New `apps/web/src/components/chat/chat-shell.tsx` — a fill-height flex column used by both types:

```
<div h-full flex flex-col min-h-0>
  <ShellHeader>        shrink-0 — name/status + per-type action slot
  [VNC panel]          local only, collapsible, shrink-0
  <Feed>               flex-1 min-h-0 — the ONLY scroller
  [usage rows]         local only (TurnUsagePanel / UsageUpdateLine), shrink-0
  <Composer>           shrink-0 — pinned, never scrolled away
</div>
```

- **Header:** one component with slots. Cloud slot: `SessionPicker`, New, close. Local slot: session status, `ContextMiniBar`, Restart/End/Settings (+ existing overflow menu below `sm`). Same typography/height for both.
- **Feed:** one `ChatFeed` wrapper around the shared `MessageScroller*` (replacing the duplicated `ChatScroller` in `packages/ui/conversation.tsx` and `terminal-feed.tsx`), parameterized by `renderRow`. Cloud rows stay `ChatRow` (flat blocks); local rows stay `BridgeChatRow` (activity spine). This is an accepted per-type difference.
- **Composer:** one `UnifiedComposer` shell (box, textarea, picker anchoring, submit/stop) with slots: cloud adds attachments + `AgentToolsMenu`; local adds model/permission/thinking selects, busy-send hint, queued chip. The two near-identical pickers (`SkillPickerList` / `SlashPickerList`) merge into one grouped picker fed different item sources.
- **Data:** untouched. Cloud keeps `useChat` + `AgentClient`; local keeps `useBridgeTerminal` + `BridgeTransport` and `useFoldedTurns`. The shell only consumes their outputs.
- Local-only turn kinds (task/plan/approval/question) keep rendering inside `BridgeChatRow`.

**Pinned composer (requirement 4).** The shell root gets a real height: `/chat` route renders it in a container sized to the viewport minus app chrome (`h-dvh` semantics via the existing page layout, `min-h-0` down the chain), with `pb-[env(safe-area-inset-bottom)]` on mobile. The local `overflow-auto` document wrapper is removed with the old route. Result: on both PC and mobile, only the feed scrolls; the input is always visible.

### 3. De-card tool rendering

Target style (from `bridge-tool-card.tsx`): at most one thin `rounded-md border` container per tool item; `border-t` dividers for internal sections; `bg-muted/40` at most; mono `text-xs` for commands/paths/output; **no shadcn Card, no nested `rounded-xl bg-card` boxes, no CardHeader/CardContent structure**.

Changes, in choke-point order:

| File | Change |
|---|---|
| `packages/ui/src/components/chat/tool.tsx` `PlainToolView` | Restyle to bridge header-line + `border-t` body (already close; align paddings/typography with `activity-item-header.tsx`). |
| `genui/finance/primitives.tsx` `CardShell` | Flatten: drop `rounded-xl bg-card p-4`; become title line + `border-t`-separated content inside a single `rounded-md border` (or borderless with `bg-muted/40`), compact padding. All ~35 finance renderers inherit. |
| `genui/finance/primitives.tsx` `FinTable` | Keep `overflow-x-auto`; drop the extra rounded box look — single hairline border, `border-t` head divider. |
| `finance/commodity-grid.tsx`, `index-grid.tsx`, `quote-card.tsx`, `candlestick-chart.tsx`, sentiment/heatmap inner tiles | Remove nested `rounded-lg border bg-card` item boxes → dividers or plain rows. |
| `genui/user-card.tsx`, `tweet-card-node.tsx`, `embedded-tweet-node.tsx` | Same flattening (single hairline container max). |
| `components/bridge/question-card.tsx` | Replace shadcn Card with flat section (label line + `border-t` options). |
| `components/bridge/event-line.tsx` `ApprovalLine` | Same. |
| `components/bridge/local-agent-card-list.tsx` | Card import disappears with the list merge (§1). |

After this, `@better-agent/ui` `card` has zero imports under `src/genui`, `src/components/chat`, `src/components/bridge` — enforceable by grep in review.

### 4. Out of scope

- No server/API changes (all data needs are met by existing oRPC routes).
- No change to the local-agent settings dialog, connection panel internals, or transports.
- Dashboard/admin pages keep their cards — the ban is on tool/message rendering only.
- No attempt to give cloud chat usage panels (it has no usage stream today).

## Error handling

- Merged list: each source query fails independently — show rows from whichever source loaded, plus the existing toast pattern for the failed one.
- Cloud token popover: `getToken` failure shows inline error text in the popover with retry.
- `/chat` with both/neither valid ids → agent grid.

## Testing

- Existing co-located `*.test.tsx` for the touched components are updated, not deleted; merged components get tests for: row normalization/sort, per-type token cell behavior (lazy fetch on open), per-type actions, redirect routes, composer slot gating, picker merge.
- Grep-check: no `components/card` imports in genui/chat/bridge paths.
- Layout: unit-testable class assertions for the shell (`flex-1 min-h-0` feed, `shrink-0` composer); manual verification on mobile viewport by the user (per workflow, no automated browser testing).

## Rollout order

1. De-card tool rendering (independent, low risk).
2. Unified agents list + nav + redirects.
3. Chat shell + pinned composer + route merge.

Each phase lands as its own commit(s) on `dev`.
