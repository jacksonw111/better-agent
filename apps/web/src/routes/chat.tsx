import { Skeleton } from "@better-agent/ui/components/skeleton";
import type { AgentClient } from "@jacksonw111/agent-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { deriveLocalAgentEntries } from "@/components/bridge/local-agent-join";
import { withSessionPolling } from "@/components/bridge/local-agent-poll";
import { AgentGrid } from "@/components/chat/agent-grid";
import { clearLastChat, saveLastChat } from "@/components/chat/chat-session";
import { ChatView } from "@/components/chat/chat-view";
import { LocalChatPanel } from "@/components/chat/local-chat-panel";
import { useRestoreChat } from "@/components/chat/use-restore-chat";
import { RocketLoader } from "@/components/rocket-loader";
import { StepTransition } from "@/components/step-transition";
import type { AgentRow, UserSessionRow } from "@/utils/api-types";
import { userAgentClient } from "@/utils/chat-client";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/chat")({
	component: HomePage,
	validateSearch: (
		search: Record<string, unknown>
	): { agentId?: string; localAgentId?: string } => ({
		agentId: typeof search.agentId === "string" ? search.agentId : undefined,
		localAgentId:
			typeof search.localAgentId === "string" ? search.localAgentId : undefined,
	}),
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

// Mirrors an AgentCard: avatar circle beside a name line and a model line.
function AgentCardSkeleton() {
	return (
		<div className="flex h-24 items-start gap-3 rounded-lg border border-transparent bg-muted/40 p-4">
			<Skeleton className="size-9 shrink-0 rounded-full" />
			<div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
				<Skeleton className="h-4 w-2/5" />
				<Skeleton className="h-3 w-3/5" />
			</div>
		</div>
	);
}

function AgentGridSkeleton() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{SKELETON_KEYS.map((key) => (
					<AgentCardSkeleton key={key} />
				))}
			</div>
		</div>
	);
}

function useLocalAgentEntries() {
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const sessions = useQuery(
		withSessionPolling(orpc.bridge.listSessions.queryOptions())
	);
	return deriveLocalAgentEntries(tokens.data ?? [], sessions.data ?? []);
}

function AgentGridView({ onSelect }: { onSelect: (agent: AgentRow) => void }) {
	const navigate = useNavigate();
	const agentsQuery = useQuery(orpc.agents.list.queryOptions());
	const localEntries = useLocalAgentEntries();
	const agents = agentsQuery.data ?? [];
	if (agentsQuery.isPending) {
		return <AgentGridSkeleton />;
	}
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
			<AgentGrid
				agents={agents}
				localEntries={localEntries}
				onSelect={onSelect}
				onSelectLocal={(entry) =>
					navigate({ search: { localAgentId: entry.token.id }, to: "/chat" })
				}
			/>
		</div>
	);
}

interface HomeSetters {
	invalidate: () => Promise<void>;
	setSelectedAgent: (a: AgentRow | null) => void;
	setSending: (v: boolean) => void;
	setSessionId: (id: string) => void;
}

async function createSession(
	agent: AgentRow,
	setters: HomeSetters
): Promise<void> {
	setters.setSending(true);
	try {
		const session = await client.userSessions.create({ agentId: agent.id });
		await setters.invalidate();
		setters.setSessionId(session.id);
		saveLastChat({ agentId: agent.id, sessionId: session.id });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to create session";
		toast.error(message);
	} finally {
		setters.setSending(false);
	}
}

interface HomeActions {
	closeChat: () => void;
	newSession: (agent: AgentRow) => void;
	resumeSession: (agent: AgentRow, sessionId: string) => void;
	selectAgent: (agent: AgentRow) => void;
	selectSession: (agent: AgentRow | null, id: string) => void;
}

function useHomeActions(setters: HomeSetters): HomeActions {
	const { setSelectedAgent, setSessionId } = setters;
	const startFresh = (agent: AgentRow) => {
		setSelectedAgent(agent);
		setSessionId("");
		createSession(agent, setters).catch(() => undefined);
	};
	return {
		closeChat: () => {
			clearLastChat();
			setSelectedAgent(null);
			setSessionId("");
		},
		// Eager flow: "New" must actually create the next session, or the page
		// would wait forever on an empty sessionId.
		newSession: startFresh,
		selectAgent: startFresh,
		// Re-attach to an existing session (picker / restored last chat) without
		// creating anything — a still-streaming turn keeps flowing.
		resumeSession: (agent, sessionId) => {
			setSelectedAgent(agent);
			setSessionId(sessionId);
			saveLastChat({ agentId: agent.id, sessionId });
		},
		selectSession: (agent, id) => {
			setSessionId(id);
			if (agent) {
				saveLastChat({ agentId: agent.id, sessionId: id });
			}
		},
	};
}

function useHomeState() {
	const [selectedAgent, setSelectedAgent] = useState<AgentRow | null>(null);
	const [sessionId, setSessionId] = useState("");
	const [sending, setSending] = useState(false);
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
	const actions = useHomeActions({
		invalidate,
		setSelectedAgent,
		setSessionId,
		setSending,
	});
	useRestoreChat(Route.useSearch().agentId, selectedAgent, actions);
	return {
		selectedAgent,
		sessionId,
		sending,
		agentClient,
		sessions,
		...actions,
	};
}

interface ChatPanelProps {
	agent: AgentRow;
	agentClient: AgentClient | null;
	onClose: () => void;
	onNewSession: () => void;
	onSessionChange: (id: string) => void;
	sessionId: string;
	sessions: UserSessionRow[];
}

function ChatPanel({
	agent,
	agentClient,
	onClose,
	onNewSession,
	onSessionChange,
	sessionId,
	sessions,
}: ChatPanelProps) {
	if (!agentClient) {
		return null;
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ChatView
				agent={agent}
				agentClient={agentClient}
				onClose={onClose}
				onNewSession={onNewSession}
				onSessionChange={onSessionChange}
				sessionId={sessionId}
				sessions={sessions}
			/>
		</div>
	);
}

const STEP_GRID = 0;
const STEP_CHAT = 1;

function HomeContent({ home }: { home: ReturnType<typeof useHomeState> }) {
	const { selectedAgent, sessionId, sending } = home;
	if (!selectedAgent) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<AgentGridView onSelect={home.selectAgent} />
			</div>
		);
	}
	if (sending || sessionId === "") {
		return <RocketLoader label="Opening chat…" />;
	}
	return (
		<ChatPanel
			agent={selectedAgent}
			agentClient={home.agentClient}
			onClose={home.closeChat}
			onNewSession={() => home.newSession(selectedAgent)}
			onSessionChange={(id) => home.selectSession(selectedAgent, id)}
			sessionId={sessionId}
			sessions={home.sessions}
		/>
	);
}

// The cloud chat experience (agent picker → session). Split out so its hooks
// never run on the local-agent branch, which renders a different subtree.
function CloudHome() {
	const home = useHomeState();
	const step =
		home.selectedAgent && home.sessionId !== "" ? STEP_CHAT : STEP_GRID;
	return (
		<StepTransition step={step}>
			<HomeContent home={home} />
		</StepTransition>
	);
}

function HomePage() {
	const { localAgentId } = Route.useSearch();
	const navigate = useNavigate();
	// localAgentId wins when both are present: its branch is checked first.
	if (localAgentId) {
		return (
			<LocalChatPanel
				onClose={() => navigate({ search: {}, to: "/chat" })}
				tokenId={localAgentId}
			/>
		);
	}
	return <CloudHome />;
}
