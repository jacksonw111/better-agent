import type { PtyOpenSpec } from "@better-agent/api/pty/frame";
import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { PtyWorkspaceTabs } from "./pty-workspace-tabs";

// P25-B / P25-C: the terminal page body. It reattaches to `sessionId` (the CLI
// replays scrollback), shows that session's title, and offers the one explicit
// stop: End session. Leaving the page (the Back link) is a DETACH — the session
// keeps running in the background; only End actually kills it, and on success we
// return to the list. On mount it fetches the current spawn spec via
// `pty.getSession` and sends it on OPEN even on a bare reattach: a live pty
// ignores it, but a pty that DIED gets RESUMED from the bound agent session
// (agentSessionStarted → the CLI's resume command). `fallbackSpec` (the URL's
// cmd/cwd for a freshly minted session) is used only if that fetch fails.

/** endSession, then return to where this session lives — its project checkout
 * if it has one, else the computer. A detach never runs this; only End does. */
function useEndSession(
	computerId: string,
	projectId: string | null,
	sessionId: string
) {
	const navigate = useNavigate();
	const goBack = () =>
		projectId
			? navigate({
					params: { computerId, projectId },
					to: "/computers/$computerId/projects/$projectId",
				})
			: navigate({ params: { computerId }, to: "/computers/$computerId" });
	const end = useMutation(
		orpc.pty.endSession.mutationOptions({
			onError: (error: Error) => toast.error(error.message),
			onSuccess: () => {
				toast.success("Session ended");
				goBack();
			},
		})
	);
	return {
		confirm: () => end.mutate({ sessionId }),
		pending: end.isPending,
	};
}

/** End session, confirmed — the one explicit stop on the terminal page. */
function EndSessionControl({
	computerId,
	projectId,
	sessionId,
}: {
	computerId: string;
	projectId: string | null;
	sessionId: string;
}) {
	const { confirm, pending } = useEndSession(computerId, projectId, sessionId);
	return (
		<Popover>
			<PopoverTrigger
				render={<Button disabled={pending} size="xs" variant="outline" />}
			>
				<SquareIcon className="size-3.5" />
				End session
			</PopoverTrigger>
			<PopoverContent>
				<PopoverTitle className="text-sm">
					End this session? Its terminal and any running agent stop for good.
				</PopoverTitle>
				<div className="mt-2 flex justify-end gap-2">
					<Button size="xs" variant="outline">
						Cancel
					</Button>
					<Button onClick={confirm} size="xs" variant="destructive">
						End
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** The spawn spec the terminal sends on OPEN. Prefer the freshly fetched
 * `getSession` spec (carries the up-to-date agent binding so a dead pty resumes)
 * and fall back to the URL-derived spec only when the fetch produced nothing. */
function toOpenSpec(
	fetched: PtyOpenSpec | undefined,
	fallbackSpec: PtyOpenSpec | null
): PtyOpenSpec | null {
	if (!fetched) {
		return fallbackSpec;
	}
	return {
		agentKind: fetched.agentKind,
		agentSessionId: fetched.agentSessionId,
		agentSessionStarted: fetched.agentSessionStarted,
		args: fetched.args,
		command: fetched.command,
		cwd: fetched.cwd,
	};
}

/** The Back link + session title + End control row. */
function TerminalHeader({
	computerId,
	projectId,
	sessionId,
	title,
}: {
	computerId: string;
	projectId: string | null;
	sessionId: string;
	title: string;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2">
			<div className="flex min-w-0 items-center gap-3">
				<Link
					className="flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
					params={{ computerId }}
					to="/computers/$computerId"
				>
					<ArrowLeftIcon className="size-4" />
					Back
				</Link>
				<h1 className="truncate font-medium text-sm">{title}</h1>
			</div>
			<EndSessionControl
				computerId={computerId}
				projectId={projectId}
				sessionId={sessionId}
			/>
		</div>
	);
}

/**
 * The /terminal/$computerId body. Reattaches to one PTY session, titling it from
 * the live session list and offering End. It fetches the current spawn spec via
 * `pty.getSession` and, once that settles, mounts the terminal so OPEN always
 * carries a spec (a live pty ignores it; a dead one resumes). Split out of the
 * route so the header + lifecycle can be tested without the route tree.
 */
export function PtyTerminalScreen({
	computerId,
	fallbackSpec = null,
	sessionId,
}: {
	computerId: string;
	fallbackSpec?: PtyOpenSpec | null;
	sessionId: string;
}) {
	const sessionsQuery = useQuery(
		orpc.pty.listSessions.queryOptions({ input: { computerId } })
	);
	const session = sessionsQuery.data?.sessions.find(
		(item) => item.sessionId === sessionId
	);

	// P25-C: the reattach spec. We wait for this to settle before mounting the
	// terminal so its first OPEN carries the up-to-date spec, never spec:null.
	const specQuery = useQuery(
		orpc.pty.getSession.queryOptions({ input: { sessionId } })
	);
	const spec = toOpenSpec(specQuery.data, fallbackSpec);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
			<TerminalHeader
				computerId={computerId}
				projectId={session?.projectId ?? null}
				sessionId={sessionId}
				title={session?.title ?? "Terminal"}
			/>
			{specQuery.isPending ? (
				<div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground text-sm">
					Loading terminal…
				</div>
			) : (
				<PtyWorkspaceTabs
					computerId={computerId}
					sessionId={sessionId}
					spec={spec}
				/>
			)}
		</div>
	);
}
