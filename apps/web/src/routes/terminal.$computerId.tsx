import { createFileRoute } from "@tanstack/react-router";
import { PtyTerminalScreen } from "@/components/pty/pty-terminal-screen";

// P25-B / P25-C: the standalone PTY terminal page. `?session=` is the STABLE
// sessionId (from `pty.createSession`); reaching this page REATTACHES to that
// background session — the CLI replays its scrollback (running agent + history
// intact). The terminal ALWAYS sends a spawn spec on OPEN, fetched fresh via
// `pty.getSession` inside the screen: a live pty ignores it, but a pty that DIED
// gets RESUMED from the bound agent session instead of lost. `?cmd`/`?cwd` are
// present only when this navigation minted a fresh session (New session) and
// serve purely as a FALLBACK if that fetch fails. Entry: the Terminal sessions
// list on the Computer / Project detail pages.
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
	// A fallback spec, used only if `getSession` can't be fetched: present when
	// this navigation minted the session (cmd present), else null. The screen
	// prefers the fetched spec so a reattach carries the up-to-date binding.
	const fallbackSpec = cmd ? { args: [], command: cmd, cwd: cwd ?? "" } : null;
	return (
		<PtyTerminalScreen
			computerId={computerId}
			fallbackSpec={fallbackSpec}
			sessionId={session}
		/>
	);
}
