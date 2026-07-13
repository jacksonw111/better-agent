import { XIcon } from "lucide-react";
import { LocalAgentDetail } from "@/components/bridge/local-agent-detail";

/** The /local/$tokenId body: same fill-height column as the cloud chat
 * panel so the composer stays pinned to the viewport bottom. */
export function LocalChatPanel({
	onClose,
	tokenId,
}: {
	onClose: () => void;
	tokenId: string;
}) {
	return (
		<div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 p-4 sm:p-6">
			<button
				className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				onClick={onClose}
				type="button"
			>
				<XIcon className="size-4" />
				Close
			</button>
			<LocalAgentDetail tokenId={tokenId} />
		</div>
	);
}
