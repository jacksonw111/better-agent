# Phase 2: Usage Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a usage analytics Dashboard at `/` (the current root), move the existing chat UI to `/chat`, and update the sidebar — all within apps/web.

**Architecture:** The existing `routes/index.tsx` chat UI is copied verbatim to `routes/chat.tsx` (route `/chat`), then `routes/index.tsx` is replaced with a new Dashboard. The Dashboard queries `orpc.usage.summary` and renders summary cards + a dual-line token chart built with recharts (or a custom SVG fallback). A new `components/dashboard/` folder holds all dashboard-specific sub-components, each ≤300 lines and every function ≤50 lines. The sidebar gains a Dashboard item at `/` and a Chat item at `/chat`.

**Tech Stack:** React 19, TanStack Router (file-based, `routeTree.gen.ts`), TanStack Query via oRPC, recharts 2.15.3 (exact, React-19-compatible), shadcn/base-ui components from `@better-agent/ui`, sonner toasts, lucide-react icons, Tailwind CSS 4.

## Global Constraints

- No `any` types anywhere
- Magic numbers: only -1, 0, 1 are allowed inline — all others extracted as named constants
- Every file ≤300 lines
- Every function/component/callback ≤50 lines
- All new dependencies pinned to exact versions (no `^` or `~`)
- Use `pnpm dlx ultracite fix` before finishing each task
- `pnpm -F web check-types` must pass
- `npx eslint <files>` must report 0 errors
- Do NOT git commit (controller commits)
- Do NOT change any backend/API files

---

### Task 1: Install recharts & verify build

**Files:**
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: `recharts` available as an import in `apps/web/src/**` with full TypeScript types

- [ ] **Step 1: Add recharts to apps/web/package.json**

Open `apps/web/package.json` and add to the `"dependencies"` object:

```json
"recharts": "2.15.3"
```

Pin it exactly — no `^` or `~`.

- [ ] **Step 2: Install packages**

```bash
cd /Users/john/better-agent && pnpm install
```

Expected: lock file updated, `recharts` and its peer `d3-*` packages resolved.

- [ ] **Step 3: Verify recharts types resolve**

```bash
cd /Users/john/better-agent && pnpm -F web check-types
```

Expected: 0 errors. If recharts causes peer-dep or type errors that cannot be resolved, STOP and switch to the SVG fallback path (see Task 4 notes). In that case: revert the `package.json` change, skip this task, and note "SVG path taken" in the report.

---

### Task 2: Move chat UI to /chat route

**Files:**
- Create: `apps/web/src/routes/chat.tsx`
- Modify: `apps/web/src/routeTree.gen.ts`

**Interfaces:**
- Consumes: All existing imports in `apps/web/src/routes/index.tsx` — unchanged
- Produces: `Route` exported from `routes/chat.tsx` at path `/chat`, renderable as `<HomePage />`

- [ ] **Step 1: Create apps/web/src/routes/chat.tsx**

Copy the entire content of `apps/web/src/routes/index.tsx`, changing exactly two things:
1. `createFileRoute("/")` → `createFileRoute("/chat")`
2. The exported route object: `export const Route = createFileRoute("/chat")({ component: HomePage })`

Full file content:

```tsx
import { Skeleton } from "@better-agent/ui/components/skeleton";
import type { AgentClient } from "@jacksonw111/agent-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { AgentGrid } from "@/components/chat/agent-grid";
import { ChatView } from "@/components/chat/chat-view";
import { WebComposer } from "@/components/chat/web-composer";
import { StepTransition } from "@/components/step-transition";
import type { AgentRow, UserSessionRow } from "@/utils/api-types";
import { userAgentClient } from "@/utils/chat-client";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/chat")({
	component: HomePage,
});

function useUserAgentClient(agentId: string | null): AgentClient | null {
	return useMemo(() => (agentId ? userAgentClient(agentId) : null), [agentId]);
}

function useUserSessions(agentId: string | null): UserSessionRow[] {
	const query = useQuery(orpc.userSessions.list.queryOptions());
	return useMemo(
		() =>
			agentId ? (query.data ?? []).filter((s) => s.agentId === agentId) : [],
		[query.data, agentId]
	);
}

const SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"];

function AgentGridSkeleton() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{SKELETON_KEYS.map((key) => (
					<Skeleton className="h-24" key={key} />
				))}
			</div>
		</div>
	);
}

function AgentGridView({ onSelect }: { onSelect: (agent: AgentRow) => void }) {
	const agentsQuery = useQuery(orpc.agents.list.queryOptions());
	const agents = agentsQuery.data ?? [];
	if (agentsQuery.isPending) {
		return <AgentGridSkeleton />;
	}
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
			<AgentGrid agents={agents} onSelect={onSelect} />
		</div>
	);
}

interface SendOpts {
	agentId: string;
	invalidate: () => Promise<void>;
	setInitialText: (text: string) => void;
	setSending: (v: boolean) => void;
	setSessionId: (id: string) => void;
	text: string;
}

async function sendFirstMessage({
	agentId,
	text,
	setSending,
	setSessionId,
	setInitialText,
	invalidate,
}: SendOpts) {
	setSending(true);
	try {
		const session = await client.userSessions.create({ agentId });
		await invalidate();
		setInitialText(text);
		setSessionId(session.id);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to send";
		toast.error(message);
	} finally {
		setSending(false);
	}
}

interface HomeActions {
	clearInitialText: () => void;
	closeChat: () => void;
	closeComposer: () => void;
	newSession: () => void;
	selectAgent: (agent: AgentRow) => void;
	selectSession: (id: string) => void;
	send: (text: string) => Promise<void>;
}

function useHomeActions(
	selectedAgent: AgentRow | null,
	invalidate: () => Promise<void>,
	setInitialText: (t: string) => void,
	setSelectedAgent: (a: AgentRow | null) => void,
	setSessionId: (id: string) => void,
	setSending: (v: boolean) => void
): HomeActions {
	const send = useCallback(
		(text: string) =>
			sendFirstMessage({
				agentId: selectedAgent?.id ?? "",
				text,
				setSending,
				setSessionId,
				setInitialText,
				invalidate,
			}),
		[selectedAgent?.id, invalidate, setSending, setSessionId, setInitialText]
	);
	return {
		clearInitialText: () => setInitialText(""),
		closeChat: () => {
			setInitialText("");
			setSessionId("");
		},
		closeComposer: () => {
			setSelectedAgent(null);
			setSessionId("");
		},
		newSession: () => {
			setInitialText("");
			setSessionId("");
		},
		selectAgent: (agent: AgentRow) => {
			setSelectedAgent(agent);
			setSessionId("");
		},
		selectSession: setSessionId,
		send,
	};
}

function useHomeState() {
	const [selectedAgent, setSelectedAgent] = useState<AgentRow | null>(null);
	const [sessionId, setSessionId] = useState("");
	const [initialText, setInitialText] = useState("");
	const [sending, setSending] = useState(false);
	const [genuiOn, setGenuiOn] = useState(false);
	const queryClient = useQueryClient();
	const agentClient = useUserAgentClient(selectedAgent?.id ?? null);
	const sessions = useUserSessions(selectedAgent?.id ?? null);
	const invalidate = useCallback(
		() =>
			queryClient.invalidateQueries({
				queryKey: orpc.userSessions.list.key(),
			}),
		[queryClient]
	);
	const actions = useHomeActions(
		selectedAgent,
		invalidate,
		setInitialText,
		setSelectedAgent,
		setSessionId,
		setSending
	);
	return {
		selectedAgent,
		sessionId,
		initialText,
		sending,
		genuiOn,
		toggleGenui: () => setGenuiOn((v) => !v),
		agentClient,
		sessions,
		...actions,
	};
}

interface ChatPanelProps {
	agent: AgentRow;
	agentClient: AgentClient | null;
	initialGenui: boolean;
	initialText: string;
	onClearInitialText: () => void;
	onClose: () => void;
	onNewSession: () => void;
	onSessionChange: (id: string) => void;
	sessionId: string;
	sessions: UserSessionRow[];
}

function ChatPanel({
	agent,
	agentClient,
	initialText,
	initialGenui,
	onClearInitialText,
	onClose,
	onNewSession,
	onSessionChange,
	sessionId,
	sessions,
}: ChatPanelProps) {
	if (!agentClient) {
		return null;
	}
	const handleSessionChange = (id: string) => {
		onClearInitialText();
		onSessionChange(id);
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ChatView
				agent={agent}
				agentClient={agentClient}
				initialGenui={initialGenui}
				initialText={initialText}
				onClose={onClose}
				onNewSession={onNewSession}
				onSessionChange={handleSessionChange}
				sessionId={sessionId}
				sessions={sessions}
			/>
		</div>
	);
}

const STEP_GRID = 0;
const STEP_COMPOSER = 1;
const STEP_CHAT = 2;

function HomeContent({ home }: { home: ReturnType<typeof useHomeState> }) {
	const { selectedAgent, sessionId } = home;
	if (!selectedAgent) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<AgentGridView onSelect={home.selectAgent} />
			</div>
		);
	}
	if (sessionId === "") {
		return (
			<WebComposer
				agent={selectedAgent}
				genuiActive={home.genuiOn}
				onClose={home.closeComposer}
				onSend={home.send}
				onSessionSelect={home.selectSession}
				onToggleGenui={home.toggleGenui}
				sending={home.sending}
				sessions={home.sessions}
			/>
		);
	}
	return (
		<ChatPanel
			agent={selectedAgent}
			agentClient={home.agentClient}
			initialGenui={home.genuiOn}
			initialText={home.initialText}
			onClearInitialText={home.clearInitialText}
			onClose={home.closeChat}
			onNewSession={home.newSession}
			onSessionChange={home.selectSession}
			sessionId={sessionId}
			sessions={home.sessions}
		/>
	);
}

function HomePage() {
	const home = useHomeState();
	let step = STEP_GRID;
	if (home.selectedAgent) {
		step = home.sessionId === "" ? STEP_COMPOSER : STEP_CHAT;
	}
	return (
		<StepTransition step={step}>
			<HomeContent home={home} />
		</StepTransition>
	);
}
```

- [ ] **Step 2: Update routeTree.gen.ts to add /chat route**

`routeTree.gen.ts` is auto-generated but must be updated manually here since we cannot run the dev watcher. Add the `/chat` route following the exact pattern of existing routes.

After the existing imports block (around line 10), add:
```ts
import { Route as ChatRouteImport } from './routes/chat'
```

After the `const IndexRoute = ...` block, add:
```ts
const ChatRoute = ChatRouteImport.update({
  id: '/chat',
  path: '/chat',
  getParentRoute: () => rootRouteImport,
} as any)
```

In the `FileRoutesByFullPath` interface, add:
```ts
  '/chat': typeof ChatRoute
```

In the `FileRoutesByTo` interface, add:
```ts
  '/chat': typeof ChatRoute
```

In the `FileRoutesById` interface, add:
```ts
  '/chat': typeof ChatRoute
```

In the `FileRouteTypes` interface:
- In `fullPaths` union, add `| '/chat'`
- In `to` union, add `| '/chat'`
- In `id` union, add `| '/chat'`

In the `RootRouteChildren` interface, add:
```ts
  ChatRoute: typeof ChatRoute
```

In the `declare module '@tanstack/react-router'` block's `FileRoutesByPath`, add:
```ts
    '/chat': {
      id: '/chat'
      path: '/chat'
      fullPath: '/chat'
      preLoaderRoute: typeof ChatRouteImport
      parentRoute: typeof rootRouteImport
    }
```

In `rootRouteChildren`, add:
```ts
  ChatRoute: ChatRoute,
```

- [ ] **Step 3: Verify types**

```bash
cd /Users/john/better-agent && pnpm -F web check-types
```

Expected: 0 errors. The `/chat` route must be recognized.

---

### Task 3: Update sidebar navigation

**Files:**
- Modify: `apps/web/src/components/sidebar.tsx`

**Interfaces:**
- Consumes: `NavSection` type from `@better-agent/ui/components/app-shell-sidebar`
- Produces: Three nav items: `/` (Dashboard, Gauge icon), `/chat` (Chat, MessageSquare icon), `/board` (Board, LayoutDashboard icon), `/agents` (Agents, Bot icon)

- [ ] **Step 1: Update sidebar.tsx**

Replace the entire file content:

```tsx
import type { NavSection } from "@better-agent/ui/components/app-shell-sidebar";
import { AppShellSidebar } from "@better-agent/ui/components/app-shell-sidebar";
import { Bot, Gauge, LayoutDashboard, MessageSquare } from "lucide-react";

import { UserMenu } from "@/components/user-menu";

const SECTIONS: readonly NavSection[] = [
	{
		kind: "item",
		item: { to: "/", label: "Dashboard", icon: Gauge },
	},
	{
		kind: "item",
		item: { to: "/chat", label: "Chat", icon: MessageSquare },
	},
	{
		kind: "item",
		item: { to: "/board", label: "Board", icon: LayoutDashboard },
	},
	{
		kind: "item",
		item: { to: "/agents", label: "Agents", icon: Bot },
	},
];

export function WebSidebar() {
	return (
		<AppShellSidebar
			brand={{ icon: Bot, title: "better-agent" }}
			footer={<UserMenu />}
			highlightLayoutId="web-sidebar-active"
			sections={SECTIONS}
			variant="sidebar"
		/>
	);
}
```

- [ ] **Step 2: Run lint fix**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix apps/web/src/components/sidebar.tsx
```

Expected: no changes needed (file is already clean).

- [ ] **Step 3: Type-check**

```bash
cd /Users/john/better-agent && pnpm -F web check-types
```

Expected: 0 errors.

---

### Task 4: Build dashboard components

**Files:**
- Create: `apps/web/src/components/dashboard/use-usage-data.ts`
- Create: `apps/web/src/components/dashboard/dashboard-constants.ts`
- Create: `apps/web/src/components/dashboard/summary-card.tsx`
- Create: `apps/web/src/components/dashboard/summary-cards.tsx`
- Create: `apps/web/src/components/dashboard/token-chart.tsx`
- Create: `apps/web/src/components/dashboard/empty-state.tsx`
- Create: `apps/web/src/components/dashboard/window-toggle.tsx`

**Interfaces:**
- Consumes: `orpc.usage.summary.queryOptions({ input: { windowDays } })` where `windowDays: 3 | 7 | 12`
- Produces: All components imported by the new `apps/web/src/routes/index.tsx`

**NOTE on recharts vs SVG path:** If Task 1 determined recharts causes build/type errors, build `token-chart.tsx` as a custom SVG component (see SVG fallback instructions at bottom of this task). The interface for `<TokenChart>` is identical either way.

- [ ] **Step 1: Create dashboard-constants.ts**

```ts
// apps/web/src/components/dashboard/dashboard-constants.ts

export const WINDOW_OPTIONS = [3, 7, 12] as const;
export type WindowDays = (typeof WINDOW_OPTIONS)[number];

export const DEFAULT_WINDOW: WindowDays = 7;

/** Cents in one dollar, for cost display */
export const CENTS_PER_DOLLAR = 100;

/** Chart color for input tokens */
export const COLOR_INPUT = "#6366f1";

/** Chart color for output tokens */
export const COLOR_OUTPUT = "#f59e0b";
```

- [ ] **Step 2: Create use-usage-data.ts**

```ts
// apps/web/src/components/dashboard/use-usage-data.ts

import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import type { WindowDays } from "./dashboard-constants";

export interface DayPoint {
	day: string;
	inputTokens: number;
	outputTokens: number;
	costCents: number;
	turns: number;
}

export interface UsageSummary {
	daily: DayPoint[];
	totals: {
		inputTokens: number;
		outputTokens: number;
		costCents: number;
		turns: number;
	};
}

/**
 * Build a continuous day axis for `windowDays` days ending today (inclusive).
 * Returns "YYYY-MM-DD" strings in ascending order.
 */
function buildDayAxis(windowDays: number): string[] {
	const MS_PER_DAY = 86_400_000;
	const today = new Date();
	return Array.from({ length: windowDays }, (_, i) => {
		const d = new Date(today.getTime() - (windowDays - 1 - i) * MS_PER_DAY);
		return d.toISOString().slice(0, 10);
	});
}

/**
 * Map sparse API rows onto the continuous day axis; missing days get zeros.
 */
function mergeDays(
	axis: string[],
	rows: DayPoint[]
): DayPoint[] {
	const byDay = new Map(rows.map((r) => [r.day, r]));
	return axis.map((day) => byDay.get(day) ?? { day, inputTokens: 0, outputTokens: 0, costCents: 0, turns: 0 });
}

export function useUsageData(windowDays: WindowDays) {
	const query = useQuery(
		orpc.usage.summary.queryOptions({ input: { windowDays } })
	);

	const raw = query.data;
	const axis = buildDayAxis(windowDays);
	const daily: DayPoint[] = raw ? mergeDays(axis, raw.daily) : [];
	const totals = raw?.totals ?? { inputTokens: 0, outputTokens: 0, costCents: 0, turns: 0 };

	return {
		isPending: query.isPending,
		isError: query.isError,
		error: query.error,
		daily,
		totals,
		isEmpty: !query.isPending && !query.isError && raw !== undefined && raw.daily.length === 0,
	};
}
```

- [ ] **Step 3: Create summary-card.tsx**

```tsx
// apps/web/src/components/dashboard/summary-card.tsx

import { Skeleton } from "@better-agent/ui/components/skeleton";
import type { LucideIcon } from "lucide-react";

interface SummaryCardProps {
	icon: LucideIcon;
	isPending: boolean;
	label: string;
	value: string;
}

export function SummaryCard({ icon: Icon, isPending, label, value }: SummaryCardProps) {
	return (
		<div className="flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm">
			<div className="flex items-center justify-between">
				<span className="text-muted-foreground text-sm font-medium">{label}</span>
				<Icon className="h-4 w-4 text-muted-foreground" />
			</div>
			{isPending ? (
				<Skeleton className="h-7 w-24" />
			) : (
				<span className="font-bold text-2xl tabular-nums">{value}</span>
			)}
		</div>
	);
}
```

- [ ] **Step 4: Create summary-cards.tsx**

```tsx
// apps/web/src/components/dashboard/summary-cards.tsx

import { Coins, MessageSquare, Zap } from "lucide-react";
import { CENTS_PER_DOLLAR } from "./dashboard-constants";
import { SummaryCard } from "./summary-card";
import type { UsageSummary } from "./use-usage-data";

interface SummaryCardsProps {
	isPending: boolean;
	totals: UsageSummary["totals"];
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M`;
	}
	if (n >= 1_000) {
		return `${(n / 1_000).toFixed(1)}K`;
	}
	return n.toString();
}

function formatCost(costCents: number): string {
	return `$${(costCents / CENTS_PER_DOLLAR).toFixed(2)}`;
}

export function SummaryCards({ isPending, totals }: SummaryCardsProps) {
	const totalTokens = totals.inputTokens + totals.outputTokens;
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<SummaryCard
				icon={Zap}
				isPending={isPending}
				label="Total Tokens"
				value={formatTokens(totalTokens)}
			/>
			<SummaryCard
				icon={Coins}
				isPending={isPending}
				label="Est. Cost"
				value={formatCost(totals.costCents)}
			/>
			<SummaryCard
				icon={MessageSquare}
				isPending={isPending}
				label="Turns"
				value={totals.turns.toLocaleString()}
			/>
		</div>
	);
}
```

- [ ] **Step 5: Create token-chart.tsx (recharts path)**

If recharts is available:

```tsx
// apps/web/src/components/dashboard/token-chart.tsx

import { Skeleton } from "@better-agent/ui/components/skeleton";
import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { COLOR_INPUT, COLOR_OUTPUT } from "./dashboard-constants";
import type { DayPoint } from "./use-usage-data";

interface TokenChartProps {
	daily: DayPoint[];
	isPending: boolean;
}

function formatDay(day: string): string {
	// "2024-07-01" → "Jul 1"
	const d = new Date(`${day}T00:00:00`);
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ChartSkeleton() {
	return <Skeleton className="h-64 w-full" />;
}

export function TokenChart({ daily, isPending }: TokenChartProps) {
	if (isPending) {
		return <ChartSkeleton />;
	}

	const data = daily.map((d) => ({
		day: formatDay(d.day),
		Input: d.inputTokens,
		Output: d.outputTokens,
	}));

	return (
		<div className="rounded-lg border bg-card p-4 shadow-sm">
			<p className="mb-4 font-medium text-sm">Token Usage</p>
			<ResponsiveContainer height={256} width="100%">
				<LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
					<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
					<XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
					<YAxis tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
					<Tooltip
						contentStyle={{
							background: "var(--popover)",
							border: "1px solid var(--border)",
							borderRadius: "6px",
							fontSize: "12px",
						}}
					/>
					<Legend wrapperStyle={{ fontSize: "12px" }} />
					<Line
						dataKey="Input"
						dot={false}
						name="Input"
						stroke={COLOR_INPUT}
						strokeWidth={2}
						type="monotone"
					/>
					<Line
						dataKey="Output"
						dot={false}
						name="Output"
						stroke={COLOR_OUTPUT}
						strokeWidth={2}
						type="monotone"
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
```

**SVG fallback** (only if recharts path failed): Build a `<TokenChart>` component that:
- Accepts the same `{ daily: DayPoint[]; isPending: boolean }` props
- Renders a `<svg viewBox="0 0 800 250">` element inside a `<div className="rounded-lg border bg-card p-4 shadow-sm">`
- Computes `maxY = Math.max(...daily.map(d => d.inputTokens + d.outputTokens), 1)` for the Y axis scale
- Draws 4 horizontal gridlines at 25%, 50%, 75%, 100% of maxY
- Draws two `<polyline>` elements: one for inputTokens (color `#6366f1`), one for outputTokens (color `#f59e0b`) — point x positions evenly spaced, y = `200 - (value / maxY) * 180`
- Shows x-axis day labels (short month+day format) at the bottom
- Includes a legend row below the SVG

- [ ] **Step 6: Create empty-state.tsx**

```tsx
// apps/web/src/components/dashboard/empty-state.tsx

import { BarChart2 } from "lucide-react";

export function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
			<BarChart2 className="h-10 w-10 opacity-40" />
			<p className="font-medium text-base">No usage yet</p>
			<p className="max-w-xs text-sm">
				Start chatting to see your token consumption here.
			</p>
		</div>
	);
}
```

- [ ] **Step 7: Create window-toggle.tsx**

```tsx
// apps/web/src/components/dashboard/window-toggle.tsx

import { WINDOW_OPTIONS, type WindowDays } from "./dashboard-constants";

interface WindowToggleProps {
	onChange: (w: WindowDays) => void;
	value: WindowDays;
}

const WINDOW_LABELS: Record<WindowDays, string> = {
	3: "3D",
	7: "7D",
	12: "12D",
};

export function WindowToggle({ onChange, value }: WindowToggleProps) {
	return (
		<div className="flex items-center gap-1 rounded-lg border bg-muted p-1">
			{WINDOW_OPTIONS.map((w) => (
				<button
					className={[
						"rounded-md px-3 py-1 text-sm font-medium transition-colors",
						value === w
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					].join(" ")}
					key={w}
					onClick={() => onChange(w)}
					type="button"
				>
					{WINDOW_LABELS[w]}
				</button>
			))}
		</div>
	);
}
```

- [ ] **Step 8: Run ultracite fix on all dashboard files**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix \
  apps/web/src/components/dashboard/dashboard-constants.ts \
  apps/web/src/components/dashboard/use-usage-data.ts \
  apps/web/src/components/dashboard/summary-card.tsx \
  apps/web/src/components/dashboard/summary-cards.tsx \
  apps/web/src/components/dashboard/token-chart.tsx \
  apps/web/src/components/dashboard/empty-state.tsx \
  apps/web/src/components/dashboard/window-toggle.tsx
```

Expected: any auto-fixable issues corrected.

- [ ] **Step 9: Type-check**

```bash
cd /Users/john/better-agent && pnpm -F web check-types
```

Expected: 0 errors.

---

### Task 5: Replace index.tsx with Dashboard route

**Files:**
- Modify: `apps/web/src/routes/index.tsx`

**Interfaces:**
- Consumes: All components from `apps/web/src/components/dashboard/`
- Produces: `Route` at path `/` rendering `<DashboardPage />`

- [ ] **Step 1: Replace apps/web/src/routes/index.tsx**

Replace the entire file with:

```tsx
// apps/web/src/routes/index.tsx

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_WINDOW, type WindowDays } from "@/components/dashboard/dashboard-constants";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { TokenChart } from "@/components/dashboard/token-chart";
import { WindowToggle } from "@/components/dashboard/window-toggle";
import { useUsageData } from "@/components/dashboard/use-usage-data";

export const Route = createFileRoute("/")({
	component: DashboardPage,
});

function DashboardHeader({
	windowDays,
	onWindowChange,
}: {
	windowDays: WindowDays;
	onWindowChange: (w: WindowDays) => void;
}) {
	return (
		<div className="flex items-center justify-between">
			<h1 className="font-semibold text-lg">Usage</h1>
			<WindowToggle onChange={onWindowChange} value={windowDays} />
		</div>
	);
}

function DashboardBody({
	daily,
	isEmpty,
	isPending,
	totals,
}: {
	daily: ReturnType<typeof useUsageData>["daily"];
	isEmpty: boolean;
	isPending: boolean;
	totals: ReturnType<typeof useUsageData>["totals"];
}) {
	if (isEmpty) {
		return <EmptyState />;
	}
	return (
		<>
			<SummaryCards isPending={isPending} totals={totals} />
			<TokenChart daily={daily} isPending={isPending} />
		</>
	);
}

function DashboardPage() {
	const [windowDays, setWindowDays] = useState<WindowDays>(DEFAULT_WINDOW);
	const { isPending, isError, error, daily, totals, isEmpty } = useUsageData(windowDays);

	useEffect(() => {
		if (isError) {
			const message = error instanceof Error ? error.message : "Failed to load usage";
			toast.error(message);
		}
	}, [isError, error]);

	return (
		<div className="flex flex-col gap-6 p-4 sm:p-6">
			<DashboardHeader onWindowChange={setWindowDays} windowDays={windowDays} />
			<DashboardBody
				daily={daily}
				isEmpty={isEmpty}
				isPending={isPending}
				totals={totals}
			/>
		</div>
	);
}
```

- [ ] **Step 2: Run ultracite fix**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix apps/web/src/routes/index.tsx
```

Expected: no breaking changes.

- [ ] **Step 3: Type-check**

```bash
cd /Users/john/better-agent && pnpm -F web check-types
```

Expected: 0 errors.

---

### Task 6: Final checks & report

**Files:**
- Create: `docs/superpowers/reports/phase2-dashboard-report.md`

- [ ] **Step 1: Run full ultracite fix**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix \
  apps/web/src/routes/index.tsx \
  apps/web/src/routes/chat.tsx \
  apps/web/src/components/sidebar.tsx \
  apps/web/src/components/dashboard/dashboard-constants.ts \
  apps/web/src/components/dashboard/use-usage-data.ts \
  apps/web/src/components/dashboard/summary-card.tsx \
  apps/web/src/components/dashboard/summary-cards.tsx \
  apps/web/src/components/dashboard/token-chart.tsx \
  apps/web/src/components/dashboard/empty-state.tsx \
  apps/web/src/components/dashboard/window-toggle.tsx
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/john/better-agent && pnpm -F web check-types
```

Record pass/fail and any error output.

- [ ] **Step 3: ESLint**

```bash
cd /Users/john/better-agent/apps/web && npx eslint \
  src/routes/index.tsx \
  src/routes/chat.tsx \
  src/components/sidebar.tsx \
  src/components/dashboard/dashboard-constants.ts \
  src/components/dashboard/use-usage-data.ts \
  src/components/dashboard/summary-card.tsx \
  src/components/dashboard/summary-cards.tsx \
  src/components/dashboard/token-chart.tsx \
  src/components/dashboard/empty-state.tsx \
  src/components/dashboard/window-toggle.tsx
```

Record pass/fail and any error output.

- [ ] **Step 4: Run existing tests**

```bash
cd /Users/john/better-agent && pnpm -F web test
```

Record pass/fail and any failures.

- [ ] **Step 5: Write report**

Write `docs/superpowers/reports/phase2-dashboard-report.md` with:
- Status: DONE / DONE_WITH_CONCERNS / BLOCKED
- Files created and modified (with absolute paths)
- Chart path taken: recharts 2.15.3 OR custom SVG (and why)
- Output of each check command (ultracite fix, check-types, eslint, test)
- Any files that approached 300/50 line limits and how they were split
- Anything unfinished or uncertain
