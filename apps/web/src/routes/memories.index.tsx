import { createFileRoute } from "@tanstack/react-router";

import { CreateMemoryDialog } from "@/components/memory/create-memory-dialog";
import { MemoryList } from "@/components/memory/memory-list";

export const Route = createFileRoute("/memories/")({
	component: MemoriesPage,
});

function MemoriesPage() {
	return (
		<div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:p-6">
			<div className="flex items-center justify-end">
				<CreateMemoryDialog />
			</div>
			<MemoryList />
		</div>
	);
}
