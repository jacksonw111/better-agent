import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import { Button } from "@better-agent/ui/components/button";
import { Link } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import type { AgentRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";

const AVATAR_INITIALS_LENGTH = 2;

function AgentCard({
	agent,
	onSelect,
}: {
	agent: AgentRow;
	onSelect: (agent: AgentRow) => void;
}) {
	return (
		<button
			className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={() => onSelect(agent)}
			type="button"
		>
			<Avatar size="default">
				<AvatarImage alt={agent.name} src={agentAvatar(agent.id)} />
				<AvatarFallback>
					{agent.name.slice(0, AVATAR_INITIALS_LENGTH).toUpperCase()}
				</AvatarFallback>
			</Avatar>
			<div className="flex min-w-0 flex-col gap-1">
				<span className="truncate font-medium text-sm">{agent.name}</span>
				<span className="truncate font-mono text-muted-foreground text-xs">
					{agent.providerId}/{agent.modelId}
				</span>
			</div>
		</button>
	);
}

export function AgentGrid({
	agents,
	onSelect,
}: {
	agents: AgentRow[];
	onSelect: (agent: AgentRow) => void;
}) {
	if (agents.length === 0) {
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
	return (
		<section
			aria-label="Agents"
			className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
		>
			{agents.map((agent) => (
				<AgentCard agent={agent} key={agent.id} onSelect={onSelect} />
			))}
		</section>
	);
}
