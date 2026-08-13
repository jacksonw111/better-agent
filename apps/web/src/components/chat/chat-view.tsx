import { Button } from "@better-agent/ui/components/button";
import { Conversation } from "@better-agent/ui/components/chat/conversation";
import { SessionPicker } from "@better-agent/ui/components/chat/session-picker";
import type { AgentClient } from "@jacksonw111/agent-client";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { AgentToolsMenu } from "@/components/chat/agent-tools-menu";
import { saveMessageAsImage } from "@/components/chat/save-message-image";
import { PdfVaultProvider } from "@/components/pdf/pdf-vault-context";
import { cloudToolRegistry } from "@/genui/tool-renderers";
import type { AgentRow, UserSessionRow } from "@/utils/api-types";
import { agentAvatar, userAvatar } from "@/utils/avatar";
import { orpc } from "@/utils/orpc";
import { useCurrentUser } from "@/utils/use-current-user";

interface ChatViewProps {
	agent: AgentRow;
	agentClient: AgentClient;
	initialText?: string;
	onClose: () => void;
	onNewSession: () => void;
	onSessionChange: (sessionId: string) => void;
	sessionId: string;
	sessions: UserSessionRow[];
}

function ChatViewHeader({
	agent,
	sessionId,
	sessions,
	onClose,
	onSessionChange,
	onNewSession,
}: Omit<ChatViewProps, "agentClient" | "initialText">) {
	return (
		<header className="shrink-0 border-b">
			{/* Inner column matches the feed's `max-w-3xl mx-auto` so header and
			 * messages sit on the same grid lines. */}
			<div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
				<div className="flex min-w-0 flex-1 items-baseline gap-2">
					<span className="truncate font-medium text-sm">{agent.name}</span>
					<span className="hidden truncate font-mono text-muted-foreground text-xs sm:inline">
						{agent.providerId}/{agent.modelId}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
					<SessionPicker
						onChange={onSessionChange}
						sessions={sessions}
						value={sessionId}
					/>
					<Button
						className="gap-1"
						onClick={onNewSession}
						size="sm"
						variant="outline"
					>
						<PlusIcon className="size-3.5" />
						<span className="hidden sm:inline">New</span>
					</Button>
					<Button
						aria-label="Back to composer"
						onClick={onClose}
						size="icon"
						variant="ghost"
					>
						<XIcon className="size-4" />
					</Button>
				</div>
			</div>
		</header>
	);
}

// The skill picker's item shape wants a plain `description: string` (never
// rendered as null); the stored column is nullable, so an unset description
// falls back to empty rather than surfacing "null" in the picker.
function toSkillPickerItems(
	rows: { description: string | null; name: string }[] | undefined
) {
	return rows?.map((row) => ({
		description: row.description ?? "",
		name: row.name,
	}));
}

export function ChatView({
	agent,
	agentClient,
	initialText,
	sessionId,
	sessions,
	onClose,
	onSessionChange,
	onNewSession,
}: ChatViewProps) {
	const { email } = useCurrentUser();
	// Feeds the composer's "/" skill picker (T5) — undefined until loaded, in
	// which case the picker simply doesn't open yet.
	const skills = useQuery(
		orpc.skills.listAssigned.queryOptions({ input: { agentId: agent.id } })
	);
	return (
		<PdfVaultProvider>
			<div className="flex min-h-0 flex-1 flex-col">
				<ChatViewHeader
					agent={agent}
					onClose={onClose}
					onNewSession={onNewSession}
					onSessionChange={onSessionChange}
					sessionId={sessionId}
					sessions={sessions}
				/>
				<Conversation
					agentClient={agentClient}
					avatars={{
						user: email ? userAvatar(email) : undefined,
						assistant: agentAvatar(agent.id),
					}}
					composerTools={<AgentToolsMenu agent={agent} />}
					initialText={initialText}
					key={sessionId}
					onSaveImage={saveMessageAsImage}
					sessionId={sessionId}
					skills={toSkillPickerItems(skills.data)}
					toolRegistry={cloudToolRegistry}
				/>
			</div>
		</PdfVaultProvider>
	);
}
