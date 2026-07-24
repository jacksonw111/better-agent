import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { PtyTerminal } from "@/components/pty/pty-terminal";

// P2-3a: the standalone PTY terminal page. Unlike the `/local/$tokenId?pty=`
// gate (which attaches to an existing bridge session), this route owns a fresh
// PTY session minted by `pty.createSession`: `?session=` is the sessionId and
// `?cmd`/`?cwd` are the spawn spec the terminal replays in its OPEN frame so
// the CLI spawns the runtime. Reaching it with the same params re-attaches to
// the live session (or respawns if it exited). Reached via the "Open terminal
// (beta)" entry on the Computer detail page.
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
			This terminal link is missing its session — open a fresh terminal from the
			computer's page.
		</p>
	);
}

function TerminalPage() {
	const { computerId } = Route.useParams();
	const { cmd, cwd, session } = Route.useSearch();

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
			<Link
				className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				params={{ computerId }}
				to="/computers/$computerId"
			>
				<ArrowLeftIcon className="size-4" />
				Back to computer
			</Link>
			{session && cmd ? (
				<PtyTerminal
					computerId={computerId}
					sessionId={session}
					spec={{ args: [], command: cmd, cwd: cwd ?? "" }}
				/>
			) : (
				<MissingSession />
			)}
		</div>
	);
}
