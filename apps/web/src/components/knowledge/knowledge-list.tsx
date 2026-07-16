import { Button } from "@better-agent/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useDebouncedValue } from "@/components/list/use-debounced-value";
import { orpc } from "@/utils/orpc";
import { groupByDay } from "./date-groups";
import { DocumentDrawer } from "./document-drawer";
import { DocumentGroups } from "./knowledge-groups";
import { KnowledgeListSkeleton } from "./knowledge-skeletons";
import type { KnowledgeDocument } from "./knowledge-types";
import { UploadProgress } from "./upload-progress";
import { useDocumentUpload } from "./use-document-upload";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

function useDeleteDocument() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.knowledgeBase.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Document deleted");
				queryClient.invalidateQueries({
					queryKey: orpc.knowledgeBase.list.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function UploadButton({ onFiles }: { onFiles: (files: File[]) => void }) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				aria-label="Upload documents"
				className="hidden"
				multiple
				onChange={(event) => {
					onFiles([...(event.target.files ?? [])]);
					event.target.value = "";
				}}
				ref={inputRef}
				type="file"
			/>
			<Button onClick={() => inputRef.current?.click()}>
				<UploadIcon className="size-4" />
				Upload
			</Button>
		</>
	);
}

function EmptyState({ searching }: { searching: boolean }) {
	return (
		<p className="rounded-lg bg-muted/40 p-8 text-center text-muted-foreground text-sm">
			{searching
				? "No documents match your search."
				: "No documents yet — upload one to get started."}
		</p>
	);
}

function DocumentResults({
	isPending,
	items,
	onDelete,
	onOpen,
	searching,
}: {
	isPending: boolean;
	items: KnowledgeDocument[];
	onDelete: (id: string) => void;
	onOpen: (doc: KnowledgeDocument) => void;
	searching: boolean;
}) {
	const groups = useMemo(
		() => groupByDay(items, (doc) => new Date(doc.createdAt)),
		[items]
	);
	if (isPending) {
		return <KnowledgeListSkeleton />;
	}
	if (items.length === 0) {
		return <EmptyState searching={searching} />;
	}
	return <DocumentGroups groups={groups} onDelete={onDelete} onOpen={onOpen} />;
}

// Search/page/drawer state + the paginated server query, split out of
// KnowledgeList so the component stays under the max-lines gate.
function useKnowledgePage() {
	const [search, setSearchState] = useState("");
	const [page, setPage] = useState(0);
	const [selected, setSelected] = useState<KnowledgeDocument | null>(null);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

	const documents = useQuery(
		orpc.knowledgeBase.list.queryOptions({
			input: {
				page,
				pageSize: PAGE_SIZE,
				search: debouncedSearch || undefined,
			},
			placeholderData: (previous) => previous,
		})
	);

	return {
		debouncedSearch,
		documents,
		drawerOpen,
		page,
		search,
		selected,
		closeDrawer: () => setDrawerOpen(false),
		openDocument: (doc: KnowledgeDocument) => {
			setSelected(doc);
			setDrawerOpen(true);
		},
		setPage,
		setSearch: (value: string) => {
			setSearchState(value);
			setPage(0);
		},
	};
}

/** The Knowledge Base page: searchable, paginated documents grouped by upload
 * day. Uploading is resumable (see use-document-upload.ts); clicking a row
 * opens the viewer drawer, which only closes via its close icon. */
export function KnowledgeList() {
	const view = useKnowledgePage();
	const upload = useDocumentUpload();
	const deleteDocument = useDeleteDocument();
	const { documents } = view;

	const items = documents.data?.items ?? [];
	const total = documents.data?.total ?? 0;

	return (
		<div className="flex flex-col gap-3">
			<ListToolbar
				action={<UploadButton onFiles={(files) => files.map(upload.start)} />}
				onSearch={view.setSearch}
				placeholder="Search documents…"
				search={view.search}
			/>
			<UploadProgress
				onCancel={upload.cancel}
				onRetry={upload.retry}
				uploads={upload.uploads}
			/>
			<DocumentResults
				isPending={documents.isPending}
				items={items}
				onDelete={(id) => deleteDocument.mutate({ documentId: id })}
				onOpen={view.openDocument}
				searching={view.debouncedSearch.length > 0}
			/>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
				total={total}
			/>
			<DocumentDrawer
				doc={view.selected}
				onClose={view.closeDrawer}
				open={view.drawerOpen}
			/>
		</div>
	);
}
