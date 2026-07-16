import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { Link } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { localAgentDisplayName } from "@/components/bridge/local-agent-format";
import type { LocalAgentEntry } from "@/components/bridge/local-agent-join";
import { AgentKindIcon } from "@/components/bridge/local-agent-kind-icon";
import { LocalAgentStatusChip } from "@/components/bridge/local-agent-status-chip";
import { EmptyState } from "@/components/layout/empty-state";
import type { AgentRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";

const AVATAR_INITIALS_LENGTH = 2;

const CARD_CLASS =
	"flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const GRID_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

// Was unified-agent-row's TYPE_LABEL; lives here now that the agents list is
// cloud-only (S3-T3) and this picker is the last cloud/local mixed surface.
const TYPE_LABEL = {
	cloud: "Cloud Agent",
	local: "Local Agent",
} as const;

function TypeBadge({ type }: { type: keyof typeof TYPE_LABEL }) {
	return (
		<Badge className="shrink-0" variant="secondary">
			{TYPE_LABEL[type]}
		</Badge>
	);
}

function AgentCard({
	agent,
	onSelect,
}: {
	agent: AgentRow;
	onSelect: (agent: AgentRow) => void;
}) {
	return (
		<button
			className={CARD_CLASS}
			onClick={() => onSelect(agent)}
			type="button"
		>
			<Avatar size="default">
				<AvatarImage alt={agent.name} src={agentAvatar(agent.id)} />
				<AvatarFallback>
					{agent.name.slice(0, AVATAR_INITIALS_LENGTH).toUpperCase()}
				</AvatarFallback>
			</Avatar>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="truncate font-medium text-sm">{agent.name}</span>
				<span className="truncate font-mono text-muted-foreground text-xs">
					{agent.providerId}/{agent.modelId}
				</span>
			</div>
			<TypeBadge type="cloud" />
		</button>
	);
}

function LocalAgentCard({
	entry,
	onSelect,
}: {
	entry: LocalAgentEntry;
	onSelect: (entry: LocalAgentEntry) => void;
}) {
	return (
		<button
			className={CARD_CLASS}
			onClick={() => onSelect(entry)}
			type="button"
		>
			<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
				<AgentKindIcon className="size-4" kind={entry.token.agentKind} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="truncate font-medium text-sm">
					{localAgentDisplayName(entry)}
				</span>
				<LocalAgentStatusChip status={entry.status} />
			</div>
			<TypeBadge type="local" />
		</button>
	);
}

function AgentGridEmpty() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<EmptyState
				action={
					<Button render={<Link to="/agents" />} size="sm">
						Create an agent
					</Button>
				}
				body="Add an agent to start chatting."
				icon={UsersIcon}
				title="No agents available"
			/>
		</div>
	);
}

function LocalAgentSection({
	entries,
	onSelect,
}: {
	entries: LocalAgentEntry[];
	onSelect: (entry: LocalAgentEntry) => void;
}) {
	return (
		<section aria-label="Local agents" className="flex flex-col gap-3">
			<h2 className="font-medium text-muted-foreground text-sm">
				Local agents
			</h2>
			<div className={GRID_CLASS}>
				{entries.map((entry) => (
					<LocalAgentCard
						entry={entry}
						key={entry.token.id}
						onSelect={onSelect}
					/>
				))}
			</div>
		</section>
	);
}

export function AgentGrid({
	agents,
	localEntries = [],
	onSelect,
	onSelectLocal,
}: {
	agents: AgentRow[];
	localEntries?: LocalAgentEntry[];
	onSelect: (agent: AgentRow) => void;
	onSelectLocal?: (entry: LocalAgentEntry) => void;
}) {
	if (agents.length === 0 && localEntries.length === 0) {
		return <AgentGridEmpty />;
	}
	return (
		<div className="flex flex-col gap-6">
			{agents.length > 0 ? (
				<section aria-label="Agents" className={GRID_CLASS}>
					{agents.map((agent) => (
						<AgentCard agent={agent} key={agent.id} onSelect={onSelect} />
					))}
				</section>
			) : null}
			{localEntries.length > 0 && onSelectLocal ? (
				<LocalAgentSection entries={localEntries} onSelect={onSelectLocal} />
			) : null}
		</div>
	);
}
