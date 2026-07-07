# Phase 3 — Admin Customer Back-Office

Status: **DONE**

## Summary

Rebuilt `apps/admin` into a customer back-office: deleted the agents/composio
UI, added a `/customers` list + `/customers/$userId` detail page (usage
chart, activity timeline, block/unblock), redirected `/` to `/customers`,
updated the sidebar, and made all tables borderless (shared `packages/ui`
change, verified against `apps/web` too).

## Files deleted (Part A)

- `apps/admin/src/routes/agents.index.tsx`
- `apps/admin/src/routes/agents.$agentId.tsx`
- `apps/admin/src/routes/composio.index.tsx`
- `apps/admin/src/routes/composio.$accountId.tsx`
- `apps/admin/src/components/agents/` (agent-form.ts, agent-token-controls.tsx,
  agent-wizard-steps.tsx, agent-wizard.tsx, agents-card.tsx,
  builtin-tools-field.tsx, composio-accounts-field.tsx, token-reveal-dialog.tsx)
- `apps/admin/src/components/composio/` (accounts-table.tsx,
  add-account-dialog.tsx, connections-section.tsx, placeholder.ts,
  toolkits-section.tsx)

Confirmed via grep that nothing else in `apps/admin` referenced these paths
before deleting. `apps/admin/src/utils/api-types.ts` had the now-unused
`AgentRow`, `ComposioAccountRow`, `ComposioToolkitRow`,
`ComposioConnectionRow`, `SessionRow`, `SessionMessageRow` exports removed
(only `ProviderCatalogRow`, `CredentialRow`, `ModelRow` remain, still used by
`components/providers/*`).

## Files created

- `apps/admin/src/utils/avatar.ts` — `userAvatar` (DiceBear thumbs), copied
  from `apps/web/src/utils/avatar.ts` (only the customer-relevant export).
- `apps/admin/src/utils/relative-time.ts` — copied verbatim from
  `apps/web/src/board/relative-time.ts` (admin has no `board/` dir).
- `apps/admin/src/components/customers/dashboard-constants.ts`,
  `use-customer-usage.ts`, `token-chart.tsx`, `window-toggle.tsx`,
  `summary-card.tsx`, `summary-cards.tsx`, `empty-state.tsx` — adapted 1:1
  from the web dashboard components; the only functional change is the query
  swapped to `orpc.admin.customerUsage` with `{ userId, windowDays }`.
- `apps/admin/src/components/customers/customer-usage-section.tsx` — new
  wrapper that owns the `windowDays` state and composes window toggle +
  summary cards + chart + empty state for a given `userId`.
- `apps/admin/src/components/customers/activity-timeline.tsx` — adapted from
  web's; queries `orpc.admin.customerActivity({ userId })` and adds
  `BanIcon`/`ShieldCheckIcon` for `account_blocked`/`account_unblocked`.
- `apps/admin/src/components/customers/customers-table.tsx` — list table
  (avatar+email, verified badge, joined date, Active/Blocked status badge,
  row action button linking to `/customers/$userId`).
- `apps/admin/src/components/customers/customer-info-card.tsx` — basic info
  card (avatar, email, joined, verified, agent count, status badge, blockedAt
  when blocked) + renders `BlockToggle`.
- `apps/admin/src/components/customers/block-toggle.tsx` — Block (destructive,
  popover-confirmed, copy: "This immediately signs them out everywhere.") /
  Unblock button; on success toasts and invalidates `getCustomer`,
  `listCustomers`, and `customerActivity` queries.
- `apps/admin/src/routes/customers.index.tsx` — list route using
  `useListView` (search by email, pagination) + loading/error via
  `orpc.admin.listCustomers`.
- `apps/admin/src/routes/customers.$userId.tsx` — detail route composing
  info card + usage section + activity timeline; on `NOT_FOUND`
  (`ORPCError` code check) toasts "Customer not found" and navigates back to
  `/customers`.

## Files modified

- `apps/admin/src/routes/index.tsx` — replaced the agent grid with
  `beforeLoad: () => { throw redirect({ to: "/customers" }) }`.
- `apps/admin/src/components/sidebar.tsx` — `SECTIONS` now: Customers
  (`/customers`, `Users` icon), Providers (`/providers`, unchanged), Users
  (`/users`, unchanged label/icon — this is the staff list). Agents +
  Composio items removed.
- `apps/admin/src/routes/users.tsx` — the wrapper `<div className="rounded-lg
  border">` around `UsersTable` had `border` dropped (now `rounded-lg`),
  since table rows no longer render internal borders and a border-only div
  around a table would look orphaned/redundant.
- `apps/admin/package.json` — added `"recharts": "2.15.3"` (exact pin) between
  `react-dom` and `sonner`, matching `apps/web/package.json`'s pin exactly.
  `pnpm install` run; verified `recharts@2.15.3` resolved in the pnpm store.
- `packages/ui/src/components/table.tsx` (Part F, shared web+admin):
  - `TableHeader`: removed `[&_tr]:border-b`.
  - `TableFooter`: removed `border-t` and `[&>tr]:last:border-b-0`, kept
    `bg-muted/50 font-medium`.
  - `TableRow`: removed `border-b`, kept hover/selected classes.
  - `TableBody`'s `[&_tr:last-child]:border-0` left as-is (harmless/no-op now).
- `apps/admin/src/routeTree.gen.ts` — auto-regenerated (a running TanStack
  Start dev/watch process picked up the route file changes; no manual `tsr
  generate` was needed/available — `tsr` isn't a standalone bin in this repo,
  route generation is via the `@tanstack/react-start` vite plugin).

### Border-wrapper audit (Part F, second half)

Grepped `apps/web/src` + `apps/admin/src` for `rounded-lg border` /
`rounded-md border` wrapper divs around `<Table>`. Found:
- `apps/admin/src/components/composio/*` — all deleted with Part A, no fix
  needed.
- `apps/admin/src/routes/users.tsx` — fixed (see above).
- Other `border` hits (`token-reveal-dialog.tsx` `<code>` block,
  `window-toggle.tsx`, `token-chart.tsx`, `summary-card.tsx` in both apps)
  are unrelated to tables (code blocks / toggle pills / stat cards) and were
  left untouched, matching the instruction to not add/remove borders
  elsewhere.

## Checks run

- `pnpm dlx ultracite fix apps/admin/src apps/admin/package.json
  packages/ui/src/components/table.tsx` → "Checked 45 files in 131ms. No
  fixes applied." (clean)
- `pnpm dlx ultracite check apps/admin/src
  packages/ui/src/components/table.tsx` → "Checked 44 files in 31ms. No
  fixes applied." (clean)
- `pnpm check-types` → **all 7 packages passed**: `@better-agent/agent`,
  `server`, `@jacksonw111/agent-client`, `@better-agent/ui`, `authz`, `web`,
  `@better-agent/admin` (7 successful, 7 total).
- `npx eslint` on all changed admin + ui files (sidebar.tsx, index.tsx,
  users.tsx, api-types.ts, table.tsx, all of `components/customers/`,
  `customers.$userId.tsx`, `customers.index.tsx`, avatar.ts,
  relative-time.ts) → **0 errors** ("ESLint: No issues found"; only a
  harmless "File ignored, no matching configuration" info notice for
  `package.json`, not a lint file).
- `pnpm -F admin test` — **skipped**: apps/admin has no `test` script in
  `package.json`.
- `pnpm -F web test` → **28/28 passed** (6 test files), confirming the
  shared `table.tsx` border removal didn't break web.

## Constraints check

- No `any` in any new/modified admin file (grepped `: any`, `<any>`,
  `as any` — zero hits).
- Magic numbers: only pre-existing `-1/0/1`-style patterns reused from the
  copied web dashboard code (e.g. `MILLION`, `THOUSAND`, `CENTS_PER_DOLLAR`
  are named consts, same as web's originals).
- File sizes: largest new file is `activity-timeline.tsx` at 129 lines; all
  new/modified admin files are well under the 300-line cap (full `wc -l`
  checked).
- Functions/components: all split to match the web originals' shape (e.g.
  `CustomerUsageSection` composes rather than inlining chart/summary logic;
  `BlockToggle` splits the confirm-popover into `BlockConfirm`); none exceed
  ~50 lines.
- Regex literals: none introduced.
- Dependency pin: `recharts` added as exact `2.15.3`, no `^`/`~`.

## Anything unfinished / notes

- Nothing left unfinished from the spec. One judgment call: the sidebar
  label for `/users` was kept as **"Users"** (not renamed to "Staff") per the
  literal "keep existing label/icon" instruction, even though the spec's own
  prose calls that section "Staff" — the two items read as "Customers" vs.
  "Users" in the sidebar, which stays unambiguous.
- Unrelated to this task: the working tree also has uncommitted changes to
  `apps/web/src/components/chat/use-preselect-agent.ts`,
  `apps/web/src/routes/chat.tsx`, `apps/web/src/index.css`, and an untracked
  `apps/web/src/components/rocket-loader.tsx` — these were not touched by
  this task and appear to be from a different concurrent change in the same
  working directory. Flagging so the controller doesn't attribute them to
  this report.
