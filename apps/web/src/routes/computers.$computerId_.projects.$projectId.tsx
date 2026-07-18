import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { ProjectDetail } from "@/components/projects/project-detail";

// Q3: one Project's detail — the long-lived checkout of one GitHub repo on
// one Computer. The `$computerId_` segment opts out of nesting under
// /computers/$computerId (that page is a leaf, not a layout).

export const Route = createFileRoute(
	"/computers/$computerId_/projects/$projectId"
)({
	component: ProjectDetailPage,
});

function ProjectDetailPage() {
	const { computerId, projectId } = Route.useParams();
	return (
		<PageContainer>
			<Link
				className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				params={{ computerId }}
				to="/computers/$computerId"
			>
				<ArrowLeftIcon className="size-4" />
				Computer
			</Link>
			<ProjectDetail computerId={computerId} projectId={projectId} />
		</PageContainer>
	);
}
