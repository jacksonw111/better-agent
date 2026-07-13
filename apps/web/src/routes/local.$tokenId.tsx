import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { LocalChatPanel } from "@/components/chat/local-chat-panel";

export const Route = createFileRoute("/local/$tokenId")({
	component: LocalAgentWorkspacePage,
});

/** One local agent's workspace — the chat panel today, the multi-tab
 * workspace (files/git/shell) in later phases of the workspace plan. */
function LocalAgentWorkspacePage() {
	const { tokenId } = Route.useParams();
	const navigate = useNavigate();
	return (
		<LocalChatPanel
			onClose={() => navigate({ to: "/local" })}
			tokenId={tokenId}
		/>
	);
}
