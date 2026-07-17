import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import {
	AgentSessionList,
	parseAgentKind,
} from "@/components/computers/agent-session-list";
import { PageContainer } from "@/components/layout/page-container";

// P3: one agent runtime's sessions on one computer. The `$computerId_`
// segment opts out of nesting under /computers/$computerId (that page is a
// leaf, not a layout).

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
				<AgentSessionList agentKind={kind} computerId={computerId} />
			) : (
				<UnknownAgent />
			)}
		</PageContainer>
	);
}
