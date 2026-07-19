import { Button } from "@better-agent/ui/components/button";
import { PixelLoading } from "@better-agent/ui/components/pixel-loading";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/list/confirm-dialog";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useDebouncedValue } from "@/components/list/use-debounced-value";
import { orpc } from "@/utils/orpc";
import { groupByDay } from "./date-groups";
import { DocumentDrawer } from "./document-drawer";
import { DocumentGroups } from "./knowledge-groups";
import type { KnowledgeDocument } from "./knowledge-types";
import { UploadDialog } from "./upload-dialog";
import { type DocumentUpload, useDocumentUpload } from "./use-document-upload";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

function useDeleteDocument(onSettled: () => void) {
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
			onSettled,
		})
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
	onDelete: (doc: KnowledgeDocument) => void;
	onOpen: (doc: KnowledgeDocument) => void;
	searching: boolean;
}) {
	const groups = useMemo(
		() => groupByDay(items, (doc) => new Date(doc.createdAt)),
		[items]
	);
	if (isPending) {
		return <PixelLoading label="Loading documents…" />;
	}
	if (items.length === 0) {
		return <EmptyState searching={searching} />;
	}
	return <DocumentGroups groups={groups} onDelete={onDelete} onOpen={onOpen} />;
}

/** Compact reopen affordance while uploads run behind a closed modal. */
function ActiveUploadsChip({
	onOpen,
	upload,
}: {
	onOpen: () => void;
	upload: DocumentUpload;
}) {
	const active = upload.uploads.filter((u) => u.status === "uploading").length;
	if (active === 0) {
		return null;
	}
	return (
		<Button className="self-start" onClick={onOpen} size="sm" variant="outline">
			<Loader2Icon className="size-3.5 animate-spin" />
			Uploading {active} {active === 1 ? "file" : "files"}…
		</Button>
	);
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

function DeleteDocumentDialog({
	onClose,
	onConfirm,
	pending,
	pendingDelete,
}: {
	onClose: () => void;
	onConfirm: (doc: KnowledgeDocument) => void;
	pending: boolean;
	pendingDelete: KnowledgeDocument | null;
}) {
	return (
		<ConfirmDialog
			description={
				pendingDelete
					? `"${pendingDelete.name}" will be permanently removed from storage. This can't be undone.`
					: ""
			}
			onConfirm={() => {
				if (pendingDelete) {
					onConfirm(pendingDelete);
				}
			}}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={pendingDelete !== null}
			pending={pending}
			title="Delete document?"
		/>
	);
}

/** The Knowledge Base page: searchable, paginated documents grouped by upload
 * day with aligned columns. Uploading happens in a modal (resumable, confetti
 * on completion); deleting always confirms through a modal; clicking a row
 * opens the viewer drawer, which only closes via its close icon. */
export function KnowledgeList() {
	const view = useKnowledgePage();
	const upload = useDocumentUpload();
	const [uploadOpen, setUploadOpen] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<KnowledgeDocument | null>(
		null
	);
	const deleteDocument = useDeleteDocument(() => setPendingDelete(null));
	const { documents } = view;
	const items = documents.data?.items ?? [];
	const total = documents.data?.total ?? 0;

	return (
		<div className="flex flex-col gap-3">
			<KnowledgeToolbar
				onUploadOpen={() => setUploadOpen(true)}
				upload={upload}
				uploadOpen={uploadOpen}
				view={view}
			/>
			<DocumentResults
				isPending={documents.isPending}
				items={items}
				onDelete={setPendingDelete}
				onOpen={view.openDocument}
				searching={view.debouncedSearch.length > 0}
			/>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
				total={total}
			/>
			<KnowledgeOverlays
				deleteDocument={deleteDocument}
				pendingDelete={pendingDelete}
				setPendingDelete={setPendingDelete}
				setUploadOpen={setUploadOpen}
				upload={upload}
				uploadOpen={uploadOpen}
				view={view}
			/>
		</div>
	);
}

function KnowledgeToolbar({
	onUploadOpen,
	upload,
	uploadOpen,
	view,
}: {
	onUploadOpen: () => void;
	upload: DocumentUpload;
	uploadOpen: boolean;
	view: ReturnType<typeof useKnowledgePage>;
}) {
	return (
		<>
			<ListToolbar
				action={
					<Button onClick={onUploadOpen}>
						<UploadIcon className="size-4" />
						Upload
					</Button>
				}
				onSearch={view.setSearch}
				placeholder="Search documents…"
				search={view.search}
			/>
			{uploadOpen ? null : (
				<ActiveUploadsChip onOpen={onUploadOpen} upload={upload} />
			)}
		</>
	);
}

function KnowledgeOverlays({
	deleteDocument,
	pendingDelete,
	setPendingDelete,
	setUploadOpen,
	upload,
	uploadOpen,
	view,
}: {
	deleteDocument: ReturnType<typeof useDeleteDocument>;
	pendingDelete: KnowledgeDocument | null;
	setPendingDelete: (doc: KnowledgeDocument | null) => void;
	setUploadOpen: (open: boolean) => void;
	upload: DocumentUpload;
	uploadOpen: boolean;
	view: ReturnType<typeof useKnowledgePage>;
}) {
	return (
		<>
			<UploadDialog
				onOpenChange={setUploadOpen}
				open={uploadOpen}
				upload={upload}
			/>
			<DeleteDocumentDialog
				onClose={() => setPendingDelete(null)}
				onConfirm={(doc) => deleteDocument.mutate({ documentId: doc.id })}
				pending={deleteDocument.isPending}
				pendingDelete={pendingDelete}
			/>
			<DocumentDrawer
				doc={view.selected}
				onClose={view.closeDrawer}
				open={view.drawerOpen}
			/>
		</>
	);
}
