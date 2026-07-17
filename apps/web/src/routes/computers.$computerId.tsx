import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { ComputerDetail } from "@/components/computers/computer-detail";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/computers/$computerId")({
	component: ComputerDetailPage,
});

/** A paired computer's detail: facts, installed agent runtimes, and a New
 * Task button pre-selecting this machine. Reached by clicking a card on
 * /computers. */
function ComputerDetailPage() {
	const { computerId } = Route.useParams();
	return (
		<PageContainer>
			<Link
				className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				to="/computers"
			>
				<ArrowLeftIcon className="size-4" />
				Computers
			</Link>
			<ComputerDetail computerId={computerId} />
		</PageContainer>
	);
}
