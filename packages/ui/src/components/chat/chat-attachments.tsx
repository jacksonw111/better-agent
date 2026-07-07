import type { AgentClient } from "@jacksonw111/agent-client";
import { Loader2Icon, XIcon } from "lucide-react";
import { useState } from "react";

import type { AttachmentRef } from "./chat-blocks";

export interface PendingAttachment {
	attachmentId?: string;
	localId: string;
	mime: string;
	name: string;
	previewUrl: string;
	status: "uploading" | "done" | "error";
}

export function usePendingAttachments(
	agentClient: AgentClient,
	sessionId: string
) {
	const [items, setItems] = useState<PendingAttachment[]>([]);

	const patch = (localId: string, next: Partial<PendingAttachment>) =>
		setItems((prev) =>
			prev.map((it) => (it.localId === localId ? { ...it, ...next } : it))
		);

	const addFiles = (files: File[]) => {
		for (const file of files) {
			const localId = crypto.randomUUID();
			const item: PendingAttachment = {
				localId,
				previewUrl: URL.createObjectURL(file),
				name: file.name,
				mime: file.type,
				status: "uploading",
			};
			setItems((prev) => [...prev, item]);
			agentClient
				.uploadAttachment(sessionId, file)
				.then((res) => patch(localId, { status: "done", attachmentId: res.id }))
				.catch(() => patch(localId, { status: "error" }));
		}
	};

	const remove = (localId: string) =>
		setItems((prev) => {
			const target = prev.find((it) => it.localId === localId);
			if (target) {
				URL.revokeObjectURL(target.previewUrl);
			}
			return prev.filter((it) => it.localId !== localId);
		});

	const clear = () =>
		setItems((prev) => {
			for (const it of prev) {
				URL.revokeObjectURL(it.previewUrl);
			}
			return [];
		});

	return { items, addFiles, remove, clear };
}

/** The attachments ready to send (uploaded successfully). */
export function readyAttachments(items: PendingAttachment[]): AttachmentRef[] {
	const ready: AttachmentRef[] = [];
	for (const it of items) {
		if (it.status === "done" && it.attachmentId) {
			ready.push({
				attachmentId: it.attachmentId,
				mime: it.mime,
				name: it.name,
			});
		}
	}
	return ready;
}

function Chip({
	item,
	onRemove,
}: {
	item: PendingAttachment;
	onRemove: (localId: string) => void;
}) {
	return (
		<div className="relative">
			<img
				alt={item.name}
				className="size-14 rounded-md border object-cover"
				height={56}
				src={item.previewUrl}
				width={56}
			/>
			{item.status === "uploading" ? (
				<div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40">
					<Loader2Icon className="size-4 animate-spin text-white" />
				</div>
			) : null}
			{item.status === "error" ? (
				<div className="absolute inset-0 rounded-md ring-2 ring-destructive" />
			) : null}
			<button
				aria-label={`Remove ${item.name}`}
				className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground"
				onClick={() => onRemove(item.localId)}
				type="button"
			>
				<XIcon className="size-3" />
			</button>
		</div>
	);
}

export function ChipRow({
	items,
	onRemove,
}: {
	items: PendingAttachment[];
	onRemove: (localId: string) => void;
}) {
	if (items.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-wrap gap-2 px-1 pb-2">
			{items.map((it) => (
				<Chip item={it} key={it.localId} onRemove={onRemove} />
			))}
		</div>
	);
}
