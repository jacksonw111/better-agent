import { Button } from "@better-agent/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { TerminalIcon } from "lucide-react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

// P2-3a: the natural entry into a new PTY terminal. Clicking it calls
// `pty.createSession` (which authorizes the computer/project and resolves the
// spawn spec), then navigates to `/terminal/$computerId` carrying the minted
// sessionId + spec in the URL — so a reload re-attaches to the same session and
// there is no hand-crafted `?pty=` link. This is the BETA path that runs
// alongside the legacy structured terminal, not a replacement.

type AgentKind = "claude-code" | "opencode" | "codex" | "pi";

export function OpenPtyTerminalButton({
	agentKind,
	children,
	computerId,
	projectId,
}: {
	agentKind: AgentKind;
	children?: React.ReactNode;
	computerId: string;
	projectId?: string;
}) {
	const navigate = useNavigate();
	const create = useMutation(
		orpc.pty.createSession.mutationOptions({
			onError: (error: Error) => toast.error(error.message),
			onSuccess: (session) => {
				navigate({
					params: { computerId },
					search: {
						cmd: session.command,
						cwd: session.cwd,
						session: session.sessionId,
					},
					to: "/terminal/$computerId",
				});
			},
		})
	);

	return (
		<Button
			disabled={create.isPending}
			onClick={() => create.mutate({ agentKind, computerId, projectId })}
			size="sm"
			type="button"
			variant="outline"
		>
			<TerminalIcon className="size-4" />
			{children ?? "Open terminal"}
			<span className="rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				beta
			</span>
		</Button>
	);
}
