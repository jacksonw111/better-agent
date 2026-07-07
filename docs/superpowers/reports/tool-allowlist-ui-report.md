# Per-agent "Limit tools" picker — implementation report

## Summary

Added a "Limit tools" step to the agent wizard's Tools step, letting the user
choose between "All tools" (allowlist `null`, default — unchanged behavior)
and "Selected tools" (an explicit `toolAllowlist: string[]` of tool names
drawn from the agent's currently-linked Composio account and MCP servers).
Built-in tools are untouched by the allowlist, matching the backend contract.

## Files created

- `apps/web/src/components/agents/tool-allowlist-field.tsx` (229 lines) — new
  component. Exports `ToolAllowlistField({ form, set })`.
  - `useComposioGroups` / `useMcpGroups`: one `useQuery` (list) + one
    `useQueries` (per-id `tools` query) each, normalized into a common
    `SourceGroup` shape (`key`, `label`, `tools`, `isPending`, `error`). Group
    labels reuse the same `orpc.composio.listAccounts` /
    `orpc.mcp.listServers` query keys the fields above already populate, so
    resolving a name is a cache hit, not an extra network call; falls back to
    "Composio" / "MCP server" if the name isn't loaded yet.
  - `ModeToggle`: two `Button`s ("All tools" / "Selected tools"), active one
    styled `variant="default"`, inactive `variant="outline"` — same toggle
    idiom as the rest of the wizard.
  - `ToolCheckboxRow` / `SourceGroupSkeleton` / `SourceGroupSection`: render
    one group heading + checkbox list per linked source, with a 3-row
    `Skeleton` while pending and small `text-destructive` text on a per-source
    fetch error (a failing source doesn't block the others).
  - Switching All → Selected seeds `toolAllowlist` with every tool name
    currently loaded across all linked sources (so the user unchecks what
    they don't want); Selected → All resets `toolAllowlist` to `null`.
  - Helper copy: "Only the selected tools are offered to the agent. Fewer
    tools = cheaper turns and better tool choice."

## Files modified

- `apps/web/src/components/agents/agent-form.ts`
  - `AgentForm.toolAllowlist: string[] | null`
  - `EMPTY_AGENT_FORM.toolAllowlist: null`
  - `toAgentInput`: passes `toolAllowlist: form.toolAllowlist` through to the
    create/update payload
  - `agentRowToForm`: `toolAllowlist: row.toolAllowlist ?? null`
- `apps/web/src/components/agents/agent-wizard-steps.tsx`
  - `ToolsStep` now renders `<ToolAllowlistField form={form} set={set} />`
    below the built-in/Composio/MCP fields, gated on
    `form.composioAccountIds.length > 0 || form.mcpServerIds.length > 0`.

No changes to `packages/*` — backend (`toolAllowlist` on
`agents.create/update`, `composio.tools`, `mcp.tools`) was already live and
used as-is.

## Checks run

- `pnpm dlx ultracite fix apps/web/src/components/agents/agent-form.ts apps/web/src/components/agents/agent-wizard-steps.tsx apps/web/src/components/agents/tool-allowlist-field.tsx`
  → initially flagged 2 `useConsistentTypeDefinitions` errors (`type` vs
  `interface`) in the new file; fixed by hand (`ToolRow`/`SourceGroup` as
  `interface`), then a clean re-run reported **no issues**.
- `pnpm check-types` → **7/7 packages pass** (`@better-agent/admin`,
  `@better-agent/agent`, `@better-agent/api`, `@better-agent/config`,
  `@better-agent/db`, `@better-agent/env`, `@better-agent/ui`,
  `@jacksonw111/agent-client`, `authz`, `server`, `web` — `web` was the only
  cache miss, all green).
- `npx eslint apps/web/src/components/agents/agent-form.ts apps/web/src/components/agents/agent-wizard-steps.tsx apps/web/src/components/agents/tool-allowlist-field.tsx`
  → **0 errors** ("No issues found").
- `pnpm -F web test` → **31/31 tests pass**, 8 test files (no existing test
  targeted `agent-form.ts`/wizard steps, so nothing needed updating there).

## Constraints check

- No `any` used.
- No new dependencies — `useQueries` comes from the already-installed
  `@tanstack/react-query`.
- No magic numbers beyond -1/0/1 (`SKELETON_ROWS` is a named tuple, not a
  numeric literal).
- File sizes: `agent-form.ts` 110 lines, `agent-wizard-steps.tsx` 266 lines,
  `tool-allowlist-field.tsx` 229 lines — all ≤300.
- Every function/component in the new file is well under 50 lines (longest is
  `useComposioGroups`/`useMcpGroups` at ~19 lines).
- Regex: none introduced.
- `git status`/`git diff --stat` confirm only the two `agents/` files were
  modified plus the one new file — nothing in `packages/*` touched, nothing
  committed.

## Anything unfinished / notes for follow-up

- The seed-on-switch-to-"Selected" reads whatever tool names are already
  resolved in the TanStack Query cache at click time. If a source's `tools`
  query is still `isPending` at that exact moment (e.g. the user flips the
  toggle within the first render before the network response lands), that
  source's tools won't be pre-checked — the group still renders once loaded,
  but the user would need to check its tools manually rather than uncheck. In
  practice the account/server pickers are selected earlier in the same wizard
  step, so by the time the toggle is used the fetches have usually resolved;
  flagging this as a known edge case rather than a blocking bug, since the
  spec's stated contract ("starts with ALL *currently-listed*") is satisfied.
- Did not add any auto-reset of `toolAllowlist` when a user removes all
  linked Composio/MCP sources after having set specific allowlist entries —
  the field simply stops rendering and the stored array becomes moot (no
  composio/mcp tools are linked anyway, so it has no effect); out of scope
  per the given spec.
- Not manually verified in a running browser per the "no auto browser
  testing" project convention — recommend a quick manual pass through the
  wizard's Tools step (link a Composio account/MCP server, toggle All ↔
  Selected, save, reopen to edit and confirm the allowlist round-trips).

## Status

DONE
