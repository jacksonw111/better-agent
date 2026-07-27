import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import {
	AGENT_LABELS,
	parseAgentKind,
} from "@/components/computers/agent-labels";
import { PageContainer } from "@/components/layout/page-container";
import { PtySessionList } from "@/components/pty/pty-session-list";

// P3: one agent runtime's sessions on one computer. The `$computerId_`
// segment opts out of nesting under /computers/$computerId (that page is a
// leaf, not a layout). P25-B fix: this renders the one-click PtySessionList
// scoped to the runtime — clicking the agent lands straight on its live
// sessions (each row reattaches in a click) instead of the old task-based
// list that detoured through a chat page and an "Open terminal" landing.

export const Route = createFileRoute(
	"/computers/$computerId_/agents/$agentKind"
)({
	component: AgentSessionsPage,
});

function UnknownAgent() {
	return (
		<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
			This agent runtime isn't recognized — the link may be wrong.
		</p>
	);
}

function AgentSessionsPage() {
	const { agentKind, computerId } = Route.useParams();
	const kind = parseAgentKind(agentKind);
	return (
		<PageContainer>
			<Link
				className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				params={{ computerId }}
				to="/computers/$computerId"
			>
				<ArrowLeftIcon className="size-4" />
				Computer
			</Link>
			{kind ? (
				<div className="flex flex-col gap-3">
					<h1 className="font-semibold text-lg">{AGENT_LABELS[kind]}</h1>
					<PtySessionList agentKind={kind} computerId={computerId} />
				</div>
			) : (
				<UnknownAgent />
			)}
		</PageContainer>
	);
}
