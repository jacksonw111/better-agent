# MCP Servers Web UI — Implementation Report

## Summary

Added the per-user MCP servers UI to `apps/web`, on top of the already-live
`orpc.mcp.*` backend (no changes made to `packages/*` or `apps/server`).

## Files created

- `apps/web/src/components/integrations/mcp-servers-section.tsx` — "MCP
  Servers" section for the integrations index page. Table of Name / URL
  (mono muted) / Auth (`••••{authLast4}` or an "Open" badge when null) /
  Created / Actions (tools preview + delete-with-confirm). Uses
  `ListToolbar` + `useListView` + `Pagination`, matching
  `accounts-list.tsx`'s house style. Includes a loading skeleton
  (`ServersSkeleton`/`ServerRowSkeleton`, mirroring `AccountsSkeleton`) and
  an empty state via the shared `IntegrationsEmptyState`.
- `apps/web/src/components/integrations/add-mcp-server-dialog.tsx` — "Add
  server" dialog with a `Tabs`-based preset picker: **X (Twitter) API**
  (prefilled name/url, required bearer-token password input with helper
  text), **X Docs** (prefilled, no token), **Custom** (free-form
  name/url/optional token). Submits to `mcp.createServer`; on success
  invalidates `mcp.listServers`, shows a success toast, and closes the
  dialog; on error shows the server's real error message via toast (same
  pattern as `add-account-dialog.tsx`).
- `apps/web/src/components/integrations/mcp-tools-preview.tsx` — popover
  trigger (wrench icon button) per server row that lazily queries
  `mcp.tools({ serverId })` and renders results as mono outline `Badge`s;
  loading skeleton and destructive-text error display, mirroring
  `agent-tools-section.tsx`.
- `apps/web/src/components/agents/mcp-servers-field.tsx` — checkbox
  multi-select of the signed-in user's MCP servers for the agent wizard
  (label = name, sublabel = url, muted), following the
  `builtin-tools-field.tsx` multi-select pattern. Empty state links to
  `/integrations` (pattern borrowed from `composio-accounts-field.tsx`).

## Files modified

- `apps/web/src/utils/api-types.ts` — added `McpServerRow`, derived from
  `Client["mcp"]["listServers"]`, alongside the existing row types.
- `apps/web/src/components/agents/agent-form.ts` — added `mcpServerIds:
string[]` to `AgentForm`, `EMPTY_AGENT_FORM`, `toAgentInput`, and
  `agentRowToForm` (sourced from `row.mcpServerIds ?? []`).
- `apps/web/src/components/agents/agent-wizard-steps.tsx` — `ToolsStep` now
  renders a new "MCP servers" heading + `McpServersField` block, placed
  after the existing "Composio integration" block.
- `apps/web/src/routes/integrations.index.tsx` — renders
  `<McpServersSection />` below `<AccountsList />` (bumped the page's
  outer `gap` from 5 to 8 to give the two sections breathing room).

## 300/50-line splits

- `add-mcp-server-dialog.tsx`'s `ServerForm` component initially came in at
  69 lines (over the 50-line function cap). Split it into `NameUrlFields`
  and `TokenField` subcomponents; `ServerForm` now just wires state to
  those two plus the submit button. Final file is 252 lines (under the
  300-line file cap).
- All other new/modified files are well under both caps (largest is
  `mcp-servers-section.tsx` at ~212 lines; `mcp-tools-preview.tsx` ~83
  lines; `mcp-servers-field.tsx` ~51 lines).

## Constraints check

- No `any` used anywhere.
- No new dependencies — reused existing `@better-agent/ui` primitives
  (`Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `Popover`, `Badge`,
  `Checkbox`, `Table`, `Skeleton`, `Dialog`, `Input`, `Label`, `Button`).
- No magic numbers beyond -1/0/1 introduced.
- Regexes: none needed in these files.

## Checks run

1. `pnpm dlx ultracite fix <changed files>` — clean, no fixes applied
   (files already formatted correctly by the Write/Edit-time formatter
   hook).
2. `pnpm check-types` — **7/7 tasks passed** (`@better-agent/agent`,
   `server`, `@jacksonw111/agent-client`, `@better-agent/ui`,
   `authz`, `@better-agent/admin`, `web`).
3. `npx eslint <changed files>` — **0 errors** (after splitting
   `ServerForm`; first pass had 1 `max-lines-per-function` error, fixed).
4. `pnpm -F web test` — **29/29 tests passed** (7 test files), unchanged
   from baseline — no existing tests needed touching for this feature.

## Anything unfinished

Nothing outstanding. The feature is implemented end-to-end per spec:
integrations-index MCP servers list/add/delete/tools-preview, and the
agent wizard's Tools step MCP servers multi-select wired through
`agent-form.ts` → `toAgentInput`/`agentRowToForm`. Not committed, per
instructions — the controller will commit.

## Status

DONE
