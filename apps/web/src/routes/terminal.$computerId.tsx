import { createFileRoute } from "@tanstack/react-router";
import { PtyTerminalScreen } from "@/components/pty/pty-terminal-screen";

// P25-B: the standalone PTY terminal page. `?session=` is the STABLE sessionId
// (from `pty.createSession`); reaching this page REATTACHES to that background
// session — the CLI replays its scrollback (running agent + history intact).
// `?cmd`/`?cwd` are present ONLY when this navigation minted a fresh session
// (New session): they form the spawn spec the terminal sends on first OPEN. A
// one-click reattach from the session list carries just `?session=` and the CLI
// attaches, never respawns. Entry: the Terminal sessions list on the Computer /
// Project detail pages.
export const Route = createFileRoute("/terminal/$computerId")({
	component: TerminalPage,
	validateSearch: (
		search: Record<string, unknown>
	): { cmd?: string; cwd?: string; session?: string } => ({
		cmd: typeof search.cmd === "string" ? search.cmd : undefined,
		cwd: typeof search.cwd === "string" ? search.cwd : undefined,
		session: typeof search.session === "string" ? search.session : undefined,
	}),
});

function MissingSession() {
	return (
		<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
			This terminal link is missing its session — open one from the Terminal
			sessions list on the computer's page.
		</p>
	);
}

function TerminalPage() {
	const { computerId } = Route.useParams();
	const { cmd, cwd, session } = Route.useSearch();

	if (!session) {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
				<MissingSession />
			</div>
		);
	}
	// A spec only when this navigation minted the session (cmd present); a
	// reattach carries none so the CLI attaches to the live pty.
	const spec = cmd ? { args: [], command: cmd, cwd: cwd ?? "" } : null;
	return (
		<PtyTerminalScreen
			computerId={computerId}
			sessionId={session}
			spec={spec}
		/>
	);
}
