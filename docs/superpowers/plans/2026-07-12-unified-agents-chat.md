# Unified Agents & Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the cloud-agents and local-agents list pages into one `/agents` page, merge the two chat experiences into one `/chat` page with a viewport-pinned composer, and remove card-style chrome from all tool rendering — on both PC and mobile web.

**Architecture:** Pure front-end refactor in `apps/web` + `packages/ui`. Data layer untouched: the merged list runs the three existing queries (`agents.list`, `bridge.listTokens`, `bridge.listSessions`) and normalizes into a `UnifiedAgentRow` discriminated union; the merged chat keeps `useChat`/`AgentClient` (cloud) and `useBridgeTerminal`/`BridgeTransport` (local) behind one route with per-type panels. De-carding restyles three choke points (`PlainToolView`, finance `CardShell`/`FinTable`, and the two shadcn-Card bridge components) to the flat bridge-tool-card style.

**Tech Stack:** React 19, TanStack Router (file routes), TanStack Query + oRPC, Tailwind, vitest (colocated `*.test.tsx`), Biome/Ultracite + eslint.

**Spec:** `docs/superpowers/specs/2026-07-12-unified-agents-chat-design.md`

## Global Constraints

- Run `pnpm dlx ultracite fix` before every commit; pre-commit runs Biome AND eslint (`eslint . --cache`) — a `biome-ignore` does not silence eslint; eslint enforces `consistent-return` and `no-void`.
- Test `describe` blocks max ~50 lines (repo lint gate); keep suites flat.
- Tests: `cd /Users/john/better-agent/apps/web && pnpm test <file>` (vitest run). packages/ui: `cd /Users/john/better-agent/packages/ui && pnpm test <file>`.
- Max-lines-per-file and max-lines-per-function gates exist — split components like the existing code does (`terminal.tsx` / `terminal-body.tsx` pattern).
- No `console.log`. No new shadcn `Card` imports anywhere under `apps/web/src/genui`, `apps/web/src/components/chat`, `apps/web/src/components/bridge`.
- Reference flat style (the target aesthetic, from `apps/web/src/components/bridge/bridge-tool-card.tsx`): at most ONE thin `rounded-md border` container per item; internal sections divided by `border-t`, never nested rounded boxes; `bg-muted/40` max; mono `text-xs` for commands/paths/output.
- Do not commit files you didn't touch (shared worktree — unstage anything not yours; never `git stash`).
- Work directly on branch `dev`.

---

## Phase 1 — De-card tool rendering

### Task 1: Flatten the generic tool block (`PlainToolView`)

**Files:**
- Modify: `packages/ui/src/components/chat/tool.tsx`
- Test: `packages/ui/src/components/chat/tool.test.tsx` (create if absent; check for an existing test first)

**Interfaces:**
- Consumes: nothing new.
- Produces: no API change — `ToolGroup`, `RenderTool`, `RenderToolResult` signatures unchanged. Visual only.

- [ ] **Step 1: Look at the current rendering + any existing test**

Read `packages/ui/src/components/chat/tool.tsx` fully. Run `ls packages/ui/src/components/chat/ | grep tool` to find existing tests.

- [ ] **Step 2: Restyle `PlainToolView` + `ToolSection` to the flat bridge style**

The container keeps its single thin border; the nested rounded `pre` boxes become `border-t` sections. Target code:

```tsx
function PlainToolView({ tool }: { tool: ToolInvocation }) {
	return (
		<Collapsible.Root
			className={cn(
				"overflow-hidden rounded-md border bg-muted/40 text-xs",
				tool.isError && "border-destructive/40"
			)}
			defaultOpen={tool.isError}
		>
			<Collapsible.Trigger className="flex w-full items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-foreground">
				<WrenchIcon className="size-3.5" />
				<span className="font-mono">{tool.toolName}</span>
				<StatusIcon status={tool.status} />
				<ChevronDownIcon className="ml-auto size-3.5 transition-transform data-[panel-open]:rotate-180" />
			</Collapsible.Trigger>
			{tool.isError ? (
				<p className="break-words border-t px-2 py-1.5 text-destructive">
					{formatValue(tool.result) || "Tool call failed."}
				</p>
			) : null}
			<Collapsible.Panel>
				<ToolSection label="Arguments" value={formatValue(tool.args)} />
				{tool.status === "running" ? null : (
					<ToolSection label="Result" value={formatValue(tool.result)} />
				)}
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

function ToolSection({ label, value }: { label: string; value: string }) {
	if (value === "") {
		return null;
	}
	return (
		<div className="border-t">
			<span className="block px-2 pt-1.5 text-muted-foreground uppercase tracking-wide">
				{label}
			</span>
			<pre className="overflow-x-auto whitespace-pre-wrap break-words bg-background/60 px-2 py-1.5 font-mono text-muted-foreground">
				{value}
			</pre>
		</div>
	);
}
```

Key changes: root loses `p-2`, gains `overflow-hidden text-xs`; trigger gains `px-2 py-1.5`; panel loses `mt-2 flex flex-col gap-2`; sections lose `rounded bg-background/60 p-2` nested-box look in favor of `border-t` dividers.

- [ ] **Step 3: Run existing ui tests, typecheck**

Run: `cd /Users/john/better-agent/packages/ui && pnpm test` — expect PASS (visual-only change; fix any class-assertion tests that referenced the old classes).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/chat/tool.tsx packages/ui/src/components/chat/tool.test.tsx
git commit -m "style(ui): flatten generic tool block to bridge flat style"
```

### Task 2: Flatten finance `CardShell` and `FinTable`

**Files:**
- Modify: `apps/web/src/genui/finance/primitives.tsx:147-204`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CardShell({title, subtitle, right, children})` and `FinTable<T>` props unchanged — every finance renderer inherits the new look with zero edits.

- [ ] **Step 1: Restyle `CardShell`**

Replace the wrapper (currently `flex w-full flex-col gap-3 rounded-xl border bg-card p-4` at line 189) with a flat header-strip + `border-t` body:

```tsx
export function CardShell({
	title,
	subtitle,
	right,
	children,
}: {
	title: string;
	subtitle?: string;
	right?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="w-full overflow-hidden rounded-md border">
			<div className="flex items-start justify-between gap-2 bg-muted/40 px-3 py-2">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate font-semibold text-sm">{title}</span>
					{subtitle ? (
						<span className="truncate text-muted-foreground text-xs">
							{subtitle}
						</span>
					) : null}
				</div>
				{right ? <div className="shrink-0">{right}</div> : null}
			</div>
			<div className="flex flex-col gap-3 border-t px-3 py-2.5">{children}</div>
		</div>
	);
}
```

- [ ] **Step 2: Restyle `FinTable`**

Line 157: `overflow-x-auto rounded-lg border` → `overflow-x-auto rounded-md border`. Leave head/rows as-is (they already use `border-b` dividers — that's the target style).

- [ ] **Step 3: Verify no finance test breaks; eyeball one renderer**

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/genui` — expect PASS (update any class assertions, e.g. `option-chain.test.tsx`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/genui/finance/primitives.tsx
git commit -m "style(genui): flatten finance CardShell/FinTable (no more bg-card boxes)"
```

### Task 3: Flatten remaining nested tile boxes in genui

**Files:**
- Modify: `apps/web/src/genui/finance/commodity-grid.tsx`, `index-grid.tsx`, `quote-card.tsx`, `candlestick-chart.tsx`, `cn-hot-list.tsx`, `divergence-card.tsx`, `prediction-markets.tsx`, `sector-heatmap.tsx`, `sentiment-compare.tsx`, `sentiment-trending.tsx`
- Modify: `apps/web/src/genui/user-card.tsx`, `apps/web/src/genui/tweet-card-node.tsx`, `apps/web/src/genui/embedded-tweet-node.tsx`

**Interfaces:** props unchanged everywhere; visual only.

- [ ] **Step 1: Sweep for nested card boxes**

Run: `cd /Users/john/better-agent/apps/web && grep -rn "rounded-\(lg\|xl\) border bg-card\|rounded-lg border bg-muted" src/genui --include="*.tsx" | grep -v test` and fix every hit:

- Grid/list ITEM boxes (`rounded-lg border bg-card p-3` in commodity-grid/index-grid, `rounded-lg border bg-muted/20 p-1.5` rows in quote-card, sub-item boxes in cn-hot-list/divergence-card/prediction-markets/sector-heatmap/sentiment-*): drop the border+bg+rounding; use plain rows separated with `divide-y` on the parent (add `divide-y` to the parent container, remove per-item `rounded-* border bg-* p-*` in favor of `px-1 py-2`-style padding), or keep a borderless `bg-muted/40 rounded-md` chip ONLY where a divider list genuinely can't work (2D grids: commodity/index/sector-heatmap tiles).
- `candlestick-chart.tsx:191` chart frame `rounded-xl border bg-card p-2` → `rounded-md border p-2` (a chart needs its frame; drop `bg-card`, drop `rounded-xl`).
- `user-card.tsx:26` `rounded-xl border bg-card p-3` → `rounded-md border p-3`.
- `tweet-card-node.tsx` / `embedded-tweet-node.tsx`: outer container → `rounded-md border` (no `bg-card`/`bg-muted/30` fills, no `rounded-xl`); inner quoted/media boxes lose their own borders where the parent already has one (use `border-t` or `divide-y`).

- [ ] **Step 2: Run genui tests**

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/genui` — expect PASS; update class assertions in `tweet-card-node.test.tsx` / `option-chain.test.tsx` if they pin old classes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/genui
git commit -m "style(genui): remove nested card boxes from tool result tiles"
```

### Task 4: De-card `QuestionCard` and `ApprovalLine`; enforce the ban

**Files:**
- Modify: `apps/web/src/components/bridge/question-card.tsx`
- Modify: `apps/web/src/components/bridge/event-line.tsx`
- Test: `apps/web/src/components/bridge/question-card.test.tsx`, `apps/web/src/components/bridge/event-line.test.tsx` (exist — keep passing)

**Interfaces:** component props unchanged; only the wrapper markup changes.

- [ ] **Step 1: Replace shadcn Card in `question-card.tsx`**

Remove the `@better-agent/ui/components/card` import. Replace `<Card size="sm"><CardHeader><CardTitle>…</CardTitle></CardHeader><CardContent>…</CardContent></Card>` with the flat pattern:

```tsx
<div className="overflow-hidden rounded-md border bg-muted/40">
	<div className="px-3 py-2">
		<p className="font-medium text-sm">{/* former CardTitle content */}</p>
	</div>
	<div className="flex flex-col gap-2 border-t px-3 py-2">
		{/* former CardContent content */}
	</div>
</div>
```

Keep every behavior (options, multi-select, submit) exactly as-is — this is a wrapper swap only.

- [ ] **Step 2: Same swap in `event-line.tsx` `ApprovalLine`**

Same pattern; `CardDescription` content becomes a `<p className="text-muted-foreground text-xs">` inside the header div.

- [ ] **Step 3: Run bridge tests**

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/components/bridge/question-card.test.tsx src/components/bridge/event-line.test.tsx` — expect PASS (fix selectors that queried Card internals).

- [ ] **Step 4: Verify the ban now holds (except the list card removed in Task 7)**

Run: `grep -rn "components/card" apps/web/src/genui apps/web/src/components/chat apps/web/src/components/bridge --include="*.tsx" | grep -v test`
Expected: only `local-agent-card-list.tsx` remains (deleted in Task 7/8).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/bridge/question-card.tsx apps/web/src/components/bridge/event-line.tsx apps/web/src/components/bridge/question-card.test.tsx apps/web/src/components/bridge/event-line.test.tsx
git commit -m "style(bridge): de-card QuestionCard and ApprovalLine"
```

---

## Phase 2 — Unified agents list

### Task 5: `UnifiedAgentRow` model + merge/sort/match helpers

**Files:**
- Create: `apps/web/src/components/agents/unified-agent-row.ts`
- Test: `apps/web/src/components/agents/unified-agent-row.test.ts`

**Interfaces:**
- Consumes: `AgentRow` (`@/utils/api-types`), `LocalAgentEntry` + `deriveLocalAgentEntries` (`@/components/bridge/local-agent-join`), `localAgentDisplayName` (`@/components/bridge/local-agent-format`), `AGENT_KIND_LABEL` (`@/components/bridge/local-agent-kind-icon`).
- Produces (used by Tasks 6–8):
  - `type UnifiedAgentRow = { type: "cloud"; agent: AgentRow } | { type: "local"; entry: LocalAgentEntry; sessionCount: number }`
  - `rowId(row): string`, `rowName(row): string`, `rowSubtitle(row): string`, `rowCreatedAt(row): Date`
  - `matchUnifiedRow(row: UnifiedAgentRow, query: string): boolean` (lowercased query; matches name, subtitle, and type label "cloud agent"/"local agent")
  - `mergeUnifiedRows(agents: AgentRow[], entries: LocalAgentEntry[], sessionCounts: Map<string, number>): UnifiedAgentRow[]` — sorted `createdAt` desc.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
	matchUnifiedRow,
	mergeUnifiedRows,
	rowCreatedAt,
	rowId,
	rowName,
	rowSubtitle,
	type UnifiedAgentRow,
} from "./unified-agent-row";

// Build minimal fakes via `as` casts — only the fields the helpers touch.
const cloudAgent = {
	createdAt: new Date("2026-07-02"),
	id: "a1",
	modelId: "claude-sonnet-5",
	name: "Researcher",
	providerId: "anthropic",
} as never;
const localEntry = {
	latestSession: null,
	status: "not-connected",
	token: {
		agentKind: "claude-code",
		createdAt: new Date("2026-07-05"),
		id: "t1",
		name: "Laptop",
	},
} as never;

describe("unified-agent-row", () => {
	it("exposes id/name/subtitle/createdAt per type", () => {
		const cloud: UnifiedAgentRow = { agent: cloudAgent, type: "cloud" };
		const local: UnifiedAgentRow = {
			entry: localEntry,
			sessionCount: 2,
			type: "local",
		};
		expect(rowId(cloud)).toBe("a1");
		expect(rowId(local)).toBe("t1");
		expect(rowName(cloud)).toBe("Researcher");
		expect(rowName(local)).toBe("Laptop");
		expect(rowSubtitle(cloud)).toBe("anthropic/claude-sonnet-5");
		expect(rowSubtitle(local)).toBe("Claude Code");
		expect(rowCreatedAt(local).getTime()).toBeGreaterThan(
			rowCreatedAt(cloud).getTime()
		);
	});

	it("merges sorted by createdAt desc and counts sessions", () => {
		const rows = mergeUnifiedRows(
			[cloudAgent],
			[localEntry],
			new Map([["t1", 2]])
		);
		expect(rows.map((r) => rowId(r))).toEqual(["t1", "a1"]);
		const local = rows[0];
		expect(local.type === "local" && local.sessionCount).toBe(2);
	});

	it("matches on name, subtitle, and type label", () => {
		const cloud: UnifiedAgentRow = { agent: cloudAgent, type: "cloud" };
		expect(matchUnifiedRow(cloud, "research")).toBe(true);
		expect(matchUnifiedRow(cloud, "anthropic")).toBe(true);
		expect(matchUnifiedRow(cloud, "cloud")).toBe(true);
		expect(matchUnifiedRow(cloud, "local")).toBe(false);
	});
});
```

Adjust `AGENT_KIND_LABEL["claude-code"]`'s expected string to whatever the constant actually says (read `local-agent-kind-icon.tsx`).

- [ ] **Step 2: Run to verify fail**

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/components/agents/unified-agent-row.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { localAgentDisplayName } from "@/components/bridge/local-agent-format";
import type { LocalAgentEntry } from "@/components/bridge/local-agent-join";
import { AGENT_KIND_LABEL } from "@/components/bridge/local-agent-kind-icon";
import type { AgentRow } from "@/utils/api-types";

/** One row of the merged Agents list — a cloud agent config or a local
 * bridge token, discriminated by `type` so cells/actions can branch. */
export type UnifiedAgentRow =
	| { type: "cloud"; agent: AgentRow }
	| { type: "local"; entry: LocalAgentEntry; sessionCount: number };

export const TYPE_LABEL: Record<UnifiedAgentRow["type"], string> = {
	cloud: "Cloud Agent",
	local: "Local Agent",
};

export function rowId(row: UnifiedAgentRow): string {
	return row.type === "cloud" ? row.agent.id : row.entry.token.id;
}

export function rowName(row: UnifiedAgentRow): string {
	return row.type === "cloud" ? row.agent.name : localAgentDisplayName(row.entry);
}

export function rowSubtitle(row: UnifiedAgentRow): string {
	return row.type === "cloud"
		? `${row.agent.providerId}/${row.agent.modelId}`
		: AGENT_KIND_LABEL[row.entry.token.agentKind];
}

export function rowCreatedAt(row: UnifiedAgentRow): Date {
	return new Date(
		row.type === "cloud" ? row.agent.createdAt : row.entry.token.createdAt
	);
}

export function matchUnifiedRow(row: UnifiedAgentRow, query: string): boolean {
	return (
		rowName(row).toLowerCase().includes(query) ||
		rowSubtitle(row).toLowerCase().includes(query) ||
		TYPE_LABEL[row.type].toLowerCase().includes(query)
	);
}

/** Merges both agent sources into one list, newest first. */
export function mergeUnifiedRows(
	agents: AgentRow[],
	entries: LocalAgentEntry[],
	sessionCounts: Map<string, number>
): UnifiedAgentRow[] {
	const rows: UnifiedAgentRow[] = [
		...agents.map((agent): UnifiedAgentRow => ({ agent, type: "cloud" })),
		...entries.map(
			(entry): UnifiedAgentRow => ({
				entry,
				sessionCount: sessionCounts.get(entry.token.id) ?? 0,
				type: "local",
			})
		),
	];
	return rows.sort(
		(a, b) => rowCreatedAt(b).getTime() - rowCreatedAt(a).getTime()
	);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/components/agents/unified-agent-row.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/agents/unified-agent-row.ts apps/web/src/components/agents/unified-agent-row.test.ts
git commit -m "feat(web): UnifiedAgentRow model for the merged agents list"
```

### Task 6: Cloud token cell in the local popover style

**Files:**
- Create: `apps/web/src/components/agents/cloud-agent-token-cell.tsx`
- Read first: `apps/web/src/components/agents/agent-token-cell.tsx` (the old inline cell — for the exact `orpc.agents.getToken` call shape), `apps/web/src/components/bridge/local-agent-token-cell.tsx` (the style to copy)
- Test: `apps/web/src/components/agents/cloud-agent-token-cell.test.tsx`

**Interfaces:**
- Consumes: `orpc.agents.getToken` (same input as old `AgentTokenCell`), `Popover`/`CopyAction` from `@better-agent/ui`.
- Produces: `CloudAgentTokenCell({ agentId }: { agentId: string })` — used by Task 7.

- [ ] **Step 1: Write failing test**

Mirror the mocking approach used in `apps/web/src/components/bridge/local-agent-token-cell` sibling tests / other agents tests (read `agents-card-list.test.tsx` for the established orpc-mocking pattern in this repo and reuse it). Assert:
1. renders a chip with the key icon and `…····` before the popover ever opens, and does NOT call `getToken`;
2. clicking the chip opens the popover and fetches the token lazily (`enabled` only when open), then shows the full token in a `<code>` plus a copy action, and the chip shows `…<last4>`;
3. a `getToken` error shows inline error text with a Retry button inside the popover.

- [ ] **Step 2: Run to verify fail**

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/components/agents/cloud-agent-token-cell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Copy `LocalAgentTokenCell`'s exact markup (same `CODE_CLASS`, same chip classes, same `PopoverContent align="start" className="w-80"`), with:

```tsx
const [open, setOpen] = useState(false);
const tokenQuery = useQuery({
	...orpc.agents.getToken.queryOptions({ input: { id: agentId } }),
	enabled: open,
});
```

Chip content: `<KeyRoundIcon className="size-3" />…{tokenQuery.data ? tokenQuery.data.slice(-4) : "····"}` (adapt to `getToken`'s actual return shape — if it returns `{ token }`, use `.token`). Popover body: one labeled block "Agent token" with the `<code>` + `CopyAction` (no run command — cloud agents have none); `tokenQuery.isPending` → a one-line "Loading…" muted text; `tokenQuery.isError` → error text + `<Button size="sm" variant="outline" onClick={() => tokenQuery.refetch()}>Retry</Button>`.

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/components/agents/cloud-agent-token-cell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/agents/cloud-agent-token-cell.tsx apps/web/src/components/agents/cloud-agent-token-cell.test.tsx
git commit -m "feat(web): cloud token cell in the local-agent popover style (lazy getToken)"
```

### Task 7: Merged list components (table, mobile list, actions, add-menu)

**Files:**
- Create: `apps/web/src/components/agents/unified-agent-list.tsx` (orchestration: queries, view, dialogs)
- Create: `apps/web/src/components/agents/unified-agent-table.tsx` (desktop table + mobile flat list + shared cells; split further if the file gate complains)
- Modify: `apps/web/src/components/bridge/add-local-agent-dialog.tsx` (add optional controlled `open`/`onOpenChange` + `hideTrigger` props; default behavior unchanged)
- Test: `apps/web/src/components/agents/unified-agent-list.test.tsx`
- Read first: `agents-card.tsx`, `local-agent-list.tsx`, `local-agent-table.tsx`, `agent-row-actions.tsx`, `use-agent-mutations.ts`, `add-local-agent-dialog.tsx`, `agents-card-list.test.tsx` + `local-agent-table.test.tsx` (test patterns)

**Interfaces:**
- Consumes: Task 5 helpers, Task 6 `CloudAgentTokenCell`, existing `LocalAgentTokenCell`, `LocalAgentIdentity`, `LocalAgentStatusChip`, `AgentRowActions`, `DeleteConfirm`, `AgentWizard`, `TokenRevealDialog`, `AddLocalAgentDialog`, `ListToolbar`/`useListView`/`Pagination`, `AgentsSkeleton`, `withSessionPolling`, `useAgentMutations`/`useAgentWizard`/`useRevealToken`, `useDeleteAgent`-equivalent (`orpc.bridge.deleteToken` mutation — lift from `local-agent-list.tsx`).
- Produces: `UnifiedAgentList()` — rendered by the route in Task 8.

- [ ] **Step 1: Write failing tests** (component-level, same render/mocking pattern as `local-agent-table.test.tsx`)

Cover: (1) rows from both sources render with a "Cloud Agent" / "Local Agent" type badge; (2) cloud row shows avatar + name→`/chat?agentId` nav and `AgentRowActions`; local row shows `LocalAgentIdentity` + status chip + `DeleteConfirm` only; (3) empty-source resilience — cloud query errors but local rows still render; (4) search matches "local" to only local rows; (5) the Add menu offers both types.

- [ ] **Step 2: Run to verify fail**

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/components/agents/unified-agent-list.test.tsx` — FAIL (module not found).

- [ ] **Step 3: Implement the table/cells file**

`unified-agent-table.tsx` — desktop columns exactly: **Agent · Type · Status · Created · Token · Actions**.

```tsx
function TypeBadge({ type }: { type: UnifiedAgentRow["type"] }) {
	return (
		<Badge className="font-normal text-muted-foreground" variant="outline">
			{TYPE_LABEL[type]}
		</Badge>
	);
}
```

Per-cell branching:
- *Agent*: `row.type === "local"` → `<LocalAgentIdentity entry={row.entry} />`; cloud → avatar block copied from `agents-card.tsx:62-70` with the name as a `hover:underline` button navigating to `/chat` `search: { agentId: row.agent.id }`, and `rowSubtitle(row)` as the mono sub-line (this replaces the old separate Model column, matching the local identity layout).
- *Status*: local → `<LocalAgentStatusChip status={row.entry.status} />`; cloud → `<span className="text-muted-foreground text-xs">—</span>`.
- *Created*: `createdFormatter.format(rowCreatedAt(row))` (same `Intl.DateTimeFormat(undefined, { dateStyle: "medium" })`).
- *Token*: local → `<LocalAgentTokenCell token={row.entry.token} />`; cloud → `<CloudAgentTokenCell agentId={row.agent.id} />`.
- *Actions*: cloud → `<AgentRowActions row={row.agent} …/>` (same callbacks as today); local → `DeleteConfirm` with the existing label text from `local-agent-table.tsx:36`.

Mobile list in the same file (or a sibling if the size gate complains): flat bordered items, NOT shadcn Card:

```tsx
<div className="flex flex-col divide-y rounded-md border">
	{rows.map((row) => (
		<div className="flex flex-col gap-2 p-3" key={rowId(row)}>
			{/* identity block (same branch as the Agent cell) */}
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
				<TypeBadge type={row.type} />
				{row.type === "local" ? <LocalAgentStatusChip status={row.entry.status} /> : null}
				<span>{createdFormatter.format(rowCreatedAt(row))}</span>
			</div>
			<div className="flex items-center justify-between">
				{/* token cell */}{/* actions */}
			</div>
		</div>
	))}
</div>
```

- [ ] **Step 4: Implement the orchestration file**

`unified-agent-list.tsx`:

```tsx
export function UnifiedAgentList() {
	const agents = useQuery(orpc.agents.list.queryOptions());
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const sessions = useQuery(
		withSessionPolling(orpc.bridge.listSessions.queryOptions())
	);
	const deleteLocal = useDeleteLocalAgent(); // lifted verbatim from local-agent-list.tsx useDeleteAgent
	const sessionData = sessions.data ?? [];
	const entries = deriveLocalAgentEntries(tokens.data ?? [], sessionData);
	const rows = mergeUnifiedRows(
		agents.data ?? [],
		entries,
		countSessionsByToken(sessionData) // lifted from local-agent-list.tsx
	);
	const view = useListView(rows, { filter: matchUnifiedRow });
	// wizard/reveal/mutations exactly as agents-card.tsx:208-212
	// AddLocalAgentDialog controlled by local state (open/onOpenChange, hideTrigger)
	if (agents.isPending && tokens.isPending) {
		return <AgentsSkeleton />;
	}
	// toolbar (Add menu) + responsive views + Pagination + FAB + dialogs
}
```

Add menu (toolbar `action` AND the mobile FAB trigger — one `DropdownMenu` each):

```tsx
<DropdownMenu>
	<DropdownMenuTrigger render={<Button size="sm" />}>Add agent</DropdownMenuTrigger>
	<DropdownMenuContent align="end">
		<DropdownMenuItem onClick={openAdd}>Cloud Agent</DropdownMenuItem>
		<DropdownMenuItem onClick={() => setLocalAddOpen(true)}>Local Agent</DropdownMenuItem>
	</DropdownMenuContent>
</DropdownMenu>
```

(Match the repo's actual DropdownMenu API — check an existing usage, e.g. `terminal-header-overflow-menu.tsx`.) Loading rule: skeleton only while BOTH sources pend; if one errors the other's rows still show (existing toast-on-error patterns stay).

`add-local-agent-dialog.tsx`: add `{ open, onOpenChange, hideTrigger }` optional props — when provided, the Dialog is controlled and the built-in toolbar/FAB triggers are not rendered. Existing standalone usage keeps working (defaults).

- [ ] **Step 5: Run to verify pass**

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/components/agents/` — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/agents/unified-agent-list.tsx apps/web/src/components/agents/unified-agent-table.tsx apps/web/src/components/agents/unified-agent-list.test.tsx apps/web/src/components/bridge/add-local-agent-dialog.tsx
git commit -m "feat(web): merged agents list — cloud + local in one table with type badges"
```

### Task 8: Wire routes + navigation, delete the old lists

**Files:**
- Modify: `apps/web/src/routes/agents.index.tsx` (render `UnifiedAgentList`)
- Modify: `apps/web/src/routes/local-agents.index.tsx` (redirect to `/agents`)
- Modify: `apps/web/src/components/sidebar.tsx:17-42`, `apps/web/src/components/layout/mobile-tab-bar.tsx:27-32`
- Delete: `apps/web/src/components/agents/agents-card.tsx`, `agents-card-list.tsx`, `agents-card-list.test.tsx`, `agent-token-cell.tsx`, `apps/web/src/components/bridge/local-agent-list.tsx`, `local-agent-table.tsx`, `local-agent-table.test.tsx`, `local-agent-card-list.tsx`, `local-agent-card-list.test.tsx`, `local-agent-list-skeleton.tsx` (keep any helper still imported elsewhere — grep before deleting each)
- Test: `apps/web/src/components/layout/mobile-tab-bar.test.tsx` (update)

**Interfaces:**
- Consumes: Task 7 `UnifiedAgentList`.
- Produces: `/agents` is the single agents page; `/local-agents` redirects; nav has one "Agents" entry.

- [ ] **Step 1: Routes**

`agents.index.tsx`: swap `AgentsCard` → `UnifiedAgentList` (keep `PageContainer`).

`local-agents.index.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/local-agents/")({
	beforeLoad: () => {
		throw redirect({ to: "/agents" });
	},
});
```

- [ ] **Step 2: Navigation**

`sidebar.tsx`: delete the `/local-agents` section entry; Agents entry becomes `match: ["/chat", "/local-agents"]`. Remove the now-unused `TerminalSquare` import.
`mobile-tab-bar.tsx`: delete the `/local-agents` tab item; Agents item `match: ["/chat", "/local-agents"]`; remove unused import. Update `mobile-tab-bar.test.tsx` expectations (3 tabs + More).

- [ ] **Step 3: Delete dead files, chase imports**

For each file in the delete list: `grep -rn "<basename-without-ext>" apps/web/src --include="*.ts*" | grep -v <the-file-itself>` — delete only when unreferenced; move any still-used helper (`countSessionsByToken`, `useDeleteAgent`) into `unified-agent-list.tsx` (done in Task 7). Keep `LocalAgentListSkeleton` deleted only if nothing imports it.

- [ ] **Step 4: Full web test + typecheck + lint**

Run: `cd /Users/john/better-agent/apps/web && pnpm test && cd /Users/john/better-agent && pnpm dlx ultracite check apps/web` — expect PASS / no new issues.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/routes/agents.index.tsx apps/web/src/routes/local-agents.index.tsx apps/web/src/components/sidebar.tsx apps/web/src/components/layout/mobile-tab-bar.tsx apps/web/src/components/layout/mobile-tab-bar.test.tsx apps/web/src/components/agents apps/web/src/components/bridge
git commit -m "feat(web): single /agents page; /local-agents redirects; nav consolidated"
```

---

## Phase 3 — Unified chat page

### Task 9: `/chat` hosts local sessions; grid shows both types; old detail route redirects

**Files:**
- Modify: `apps/web/src/routes/chat.tsx` (search params, local panel branch, grid)
- Create: `apps/web/src/components/chat/local-chat-panel.tsx`
- Modify: `apps/web/src/routes/local-agents.$tokenId.tsx` (redirect)
- Modify: `apps/web/src/components/chat/agent-grid.tsx` (accept a unified item list OR add a parallel local section — see step 3)
- Test: `apps/web/src/components/chat/local-chat-panel.test.tsx`
- Read first: `chat.tsx`, `local-agent-detail.tsx`, `agent-grid.tsx`, `use-restore-chat.ts`

**Interfaces:**
- Consumes: `LocalAgentDetail` (unchanged internals), Task 5 helpers for grid items.
- Produces: `/chat` search schema `{ agentId?: string; localAgentId?: string }`; `LocalChatPanel({ tokenId, onClose })`.

- [ ] **Step 1: Search schema + branch**

`chat.tsx` `validateSearch`:

```tsx
validateSearch: (
	search: Record<string, unknown>
): { agentId?: string; localAgentId?: string } => ({
	agentId: typeof search.agentId === "string" ? search.agentId : undefined,
	localAgentId:
		typeof search.localAgentId === "string" ? search.localAgentId : undefined,
}),
```

In `HomePage`/`HomeContent`: when `localAgentId` is set, render `<LocalChatPanel onClose={() => navigate({ search: {}, to: "/chat" })} tokenId={localAgentId} />` instead of the cloud flow (cloud restore logic untouched when the param is absent).

- [ ] **Step 2: `LocalChatPanel`**

```tsx
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { LocalAgentDetail } from "@/components/bridge/local-agent-detail";

/** The /chat body for a local agent: same fill-height column as the cloud
 * panel so the composer stays pinned to the viewport bottom. */
export function LocalChatPanel({
	onClose,
	tokenId,
}: {
	onClose: () => void;
	tokenId: string;
}) {
	return (
		<div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 p-4 sm:p-6">
			<button
				className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				onClick={onClose}
				type="button"
			>
				<XIcon className="size-4" />
				Close
			</button>
			<LocalAgentDetail tokenId={tokenId} />
		</div>
	);
}
```

(No `overflow-auto` — Task 10 makes the inner feed the only scroller.)

- [ ] **Step 3: Grid shows local agents**

In `chat.tsx`'s `AgentGridView`: also query `orpc.bridge.listTokens` + `orpc.bridge.listSessions`, derive entries, and render a second grid section "Local agents" under the cloud grid — each item: `AgentKindIcon` + display name + `LocalAgentStatusChip`, `onClick` → `navigate({ search: { localAgentId: entry.token.id }, to: "/chat" })`. Reuse the existing card-item styling from `agent-grid.tsx` (extend `AgentGrid` with an optional `localEntries`/`onSelectLocal` prop pair rather than duplicating the grid markup). Add a small type badge (`TYPE_LABEL`) on every item so the two sections read consistently.

- [ ] **Step 4: Redirect the old detail route**

`local-agents.$tokenId.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/local-agents/$tokenId")({
	beforeLoad: ({ params }) => {
		throw redirect({
			search: { localAgentId: params.tokenId },
			to: "/chat",
		});
	},
});
```

- [ ] **Step 5: Tests**

`local-chat-panel.test.tsx`: renders `LocalAgentDetail` for the tokenId (mock it), close button fires `onClose`; a `chat` route test already existing? — `grep -rn "validateSearch" apps/web/src/routes/*.test.* ` first; add assertions for the new param parse if a route test exists, otherwise cover via the panel test only.

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/components/chat` — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/chat.tsx apps/web/src/routes/local-agents.$tokenId.tsx apps/web/src/components/chat/local-chat-panel.tsx apps/web/src/components/chat/local-chat-panel.test.tsx apps/web/src/components/chat/agent-grid.tsx
git commit -m "feat(web): /chat hosts local agent sessions; unified agent picker grid"
```

### Task 10: Pin the composer — fill-height chain for the local chat

**Files:**
- Modify: `apps/web/src/components/bridge/local-agent-detail.tsx:94-115` (`SessionView` wrapper)
- Modify: `apps/web/src/components/bridge/local-agent-detail.tsx:127-160` (`LocalAgentDetail` returned wrappers)
- Read first: how the cloud chat gets its height (`chat.tsx` `ChatPanel` → `flex min-h-0 flex-1 flex-col`, and the authed shell/`PageContainer` for `pb-tab-bar` handling on mobile)

**Interfaces:** no prop changes; layout classes only.

- [ ] **Step 1: Make the local chain fill height**

- `SessionView` root `local-agent-detail.tsx:94`: `"flex flex-col gap-4"` → `"flex min-h-0 flex-1 flex-col gap-4"` (the `RemoteDesktopPanel` stays `shrink-0` by default; `Terminal` is already `flex min-h-0 flex-1 flex-col`).
- `LocalAgentDetail`: ensure every state it returns participates in the flex chain — wrap `SessionView` return unchanged (it now stretches); `WaitingForCli`/`NotFound`/skeleton can stay static (no composer to pin).

- [ ] **Step 2: Verify the only scroller is the feed**

With Task 9's `LocalChatPanel` (no `overflow-auto`), the chain is: route flex column → `LocalChatPanel` `flex-1 min-h-0` → `SessionView` `flex-1 min-h-0` → `Terminal` `flex-1 min-h-0` → `TerminalFeed`'s `MessageScrollerViewport` scrolls. Manually check with long content that (a) the page body never scrolls, (b) the composer is visible on load without scrolling, on desktop AND a mobile-width viewport (dev tools). Confirm the mobile dock (`MobileTabBar`) doesn't cover the composer — the composer container already has bottom padding; if the dock overlaps, add the same `pb-tab-bar`-aware padding the cloud chat's shell uses (find it: `grep -rn "pb-tab-bar" apps/web/src`).

- [ ] **Step 3: Run bridge tests**

Run: `cd /Users/john/better-agent/apps/web && pnpm test src/components/bridge` — expect PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/bridge/local-agent-detail.tsx
git commit -m "fix(web): pin local-agent composer to viewport bottom (feed is sole scroller)"
```

### Task 11: Composer + feed visual parity between the two chats

**Files:**
- Modify: `packages/ui/src/components/chat/chat-composer.tsx` (cloud composer box)
- Modify: `apps/web/src/components/bridge/terminal-composer.tsx` (local composer box)
- Read first: both files fully; `terminal-composer.test.tsx`, `chat-composer` tests in packages/ui if any

**Interfaces:** no prop changes.

- [ ] **Step 1: Align the two composer shells**

Make these identical in both files (local adopts cloud's roundness; both keep their own feature slots):
- Outer wrapper: `"mx-auto w-full max-w-3xl shrink-0 px-3 pb-4 sm:px-4"` (cloud currently lacks `mx-auto max-w-3xl` on the outer — it's on an inner div; local uses `py-3`. Normalize both to the same structure: outer positioning wrapper + `ComposerBox` with `relative mx-auto max-w-3xl`).
- `PromptInput` container: `rounded-2xl` in BOTH (local currently `rounded-lg` at `terminal-composer.tsx:121`).
- Same placeholder/typography classes on `PromptInputTextarea`.

- [ ] **Step 2: Align the two headers**

Read `apps/web/src/components/chat/chat-view.tsx` (header at top) and `apps/web/src/components/bridge/terminal-header.tsx`. Do NOT merge their logic — only normalize the container: same height/padding/border (`border-b`), same inner `mx-auto max-w-3xl` alignment (terminal already has it — give the cloud header the same), same title typography (name `font-medium text-sm`, sub-line `text-muted-foreground text-xs`). Feature clusters (SessionPicker/New/Close vs Restart/End/Settings) stay as-is on their own side.

- [ ] **Step 3: Align the feed empty states**

`terminal-feed.tsx` `EmptyTerminal` adopts the same two-line `RevealText` layout as `conversation.tsx`'s `EmptyMessages` (keep the local copy text "No output yet — waiting for the agent…" as the first line; second line muted). Import `RevealText` from `@better-agent/ui`.

- [ ] **Step 4: Run both packages' tests**

Run: `cd /Users/john/better-agent/packages/ui && pnpm test && cd /Users/john/better-agent/apps/web && pnpm test src/components/bridge/terminal-composer.test.tsx src/components/bridge/terminal.test.tsx` — expect PASS (update class assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/chat/chat-composer.tsx apps/web/src/components/bridge/terminal-composer.tsx apps/web/src/components/bridge/terminal-feed.tsx apps/web/src/components/chat/chat-view.tsx apps/web/src/components/bridge/terminal-header.tsx
git commit -m "style(chat): identical composer/header shell + empty state across cloud/local chat"
```

### Task 12: Final QA gate

**Files:** none new.

- [ ] **Step 1: Full test suites**

Run: `cd /Users/john/better-agent/apps/web && pnpm test` and `cd /Users/john/better-agent/packages/ui && pnpm test` — expect PASS.

- [ ] **Step 2: Lint/format/typecheck**

Run: `cd /Users/john/better-agent && pnpm dlx ultracite check apps/web packages/ui` and `pnpm lint` (eslint) and the workspace typecheck (`pnpm -r --filter web --filter @better-agent/ui exec tsc --noEmit` or the repo's `check-types` script if present — `grep '"check-types"' apps/web/package.json`). Expect clean.

- [ ] **Step 3: Card-ban grep gate**

Run: `grep -rn "components/card" apps/web/src/genui apps/web/src/components/chat apps/web/src/components/bridge --include="*.tsx" | grep -v test`
Expected: empty output.

- [ ] **Step 4: Dead-route grep**

Run: `grep -rn '"/local-agents' apps/web/src --include="*.tsx" | grep -v routes/local-agents` — remaining hits must only be nav `match` arrays and redirects.

- [ ] **Step 5: Commit any stragglers, then notify the user to test in the browser**

Per project workflow: do NOT drive the browser yourself; push to `dev` (GitHub Action deploys to Workers test) and hand off for manual verification — merged `/agents` list (both types, token popovers), `/chat` with a cloud agent and a local agent, pinned composer on mobile, flattened tool cards in both chats.
