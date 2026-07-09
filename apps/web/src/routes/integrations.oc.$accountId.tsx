import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { OcAccountDetail } from "@/components/integrations/oc-account-detail";

export const Route = createFileRoute("/integrations/oc/$accountId")({
	component: OcAccountDetailPage,
});

function OcAccountDetailPage() {
	const { accountId } = Route.useParams();

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
			<Link
				className="flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				search={{ tab: "openconnector" }}
				to="/integrations"
			>
				<ArrowLeftIcon className="size-4" />
				Integrations
			</Link>
			<OcAccountDetail accountId={accountId} />
		</div>
	);
}
