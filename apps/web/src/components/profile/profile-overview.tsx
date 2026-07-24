import {
	Card,
	CardContent,
	CardDescription,
	CardTitle,
} from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useNavigate } from "@tanstack/react-router";
import {
	FileStack,
	type LucideIcon,
	Plug,
	ScrollText,
	Wand2,
} from "lucide-react";
import { useProfile } from "./use-profile";

type Go = () => void;

interface Piece {
	body: string;
	icon: LucideIcon;
	label: string;
}

function PieceCard({ piece, onOpen }: { piece: Piece; onOpen: Go }) {
	return (
		<button
			className="rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
			onClick={onOpen}
			type="button"
		>
			<Card className="h-full transition-colors hover:bg-muted/40">
				<CardContent className="flex items-start gap-3">
					<piece.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
					<div className="flex flex-col gap-1">
						<CardTitle>{piece.label}</CardTitle>
						<CardDescription>{piece.body}</CardDescription>
					</div>
				</CardContent>
			</Card>
		</button>
	);
}

function VersionBlock() {
	const profile = useProfile();
	return (
		<div className="flex flex-col gap-1 rounded-xl bg-muted/40 p-4">
			<div className="flex items-baseline gap-2">
				<span className="text-muted-foreground text-sm">Profile version</span>
				{profile.isPending ? (
					<Skeleton className="h-5 w-8" />
				) : (
					<span className="font-semibold text-lg tabular-nums">
						v{profile.data?.version ?? 0}
					</span>
				)}
			</div>
			<p className="text-muted-foreground text-xs">
				Every change bumps this version. Each computer re-syncs to it the next
				time it checks in.
			</p>
		</div>
	);
}

// The four Profile pieces. Standards/Templates switch this page's tab;
// Skills/Integrations route to their existing pages.
function usePieces(): { piece: Piece; onOpen: Go }[] {
	const navigate = useNavigate();
	return [
		{
			piece: {
				body: "Rules that land in every computer's global CLAUDE.md.",
				icon: ScrollText,
				label: "Standards",
			},
			onOpen: () => navigate({ search: { tab: "standards" }, to: "/profile" }),
		},
		{
			piece: {
				body: "One-click scaffolds for new projects.",
				icon: FileStack,
				label: "Templates",
			},
			onOpen: () => navigate({ search: { tab: "templates" }, to: "/profile" }),
		},
		{
			piece: {
				body: "Reusable playbooks your agents can run.",
				icon: Wand2,
				label: "Skills",
			},
			onOpen: () => navigate({ to: "/skills" }),
		},
		{
			piece: {
				body: "MCP servers and connected accounts.",
				icon: Plug,
				label: "Integrations",
			},
			onOpen: () => navigate({ to: "/integrations" }),
		},
	];
}

/** The Profile overview: what a Profile is, its current version, and cards into
 * the four pieces — all framed as one development spec. */
export function ProfileOverview() {
	const pieces = usePieces();
	return (
		<div className="flex flex-col gap-5">
			<p className="max-w-2xl text-muted-foreground text-sm">
				Your Profile is one development spec — standards, project templates,
				skills, and MCP servers — that syncs to every computer you pair.
			</p>
			<VersionBlock />
			<div className="grid gap-3 sm:grid-cols-2">
				{pieces.map((entry) => (
					<PieceCard
						key={entry.piece.label}
						onOpen={entry.onOpen}
						piece={entry.piece}
					/>
				))}
			</div>
		</div>
	);
}
