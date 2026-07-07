import { Button } from "@better-agent/ui/components/button";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@better-agent/ui/components/prompt-input";
import type { AgentClient } from "@jacksonw111/agent-client";
import { ImagePlusIcon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import {
	ChipRow,
	readyAttachments,
	usePendingAttachments,
} from "./chat-attachments";
import type { AttachmentRef } from "./chat-blocks";

const ACCEPT_IMAGES = "image/png,image/jpeg,image/webp,image/gif";

function AttachButton({ onFiles }: { onFiles: (files: File[]) => void }) {
	const fileRef = useRef<HTMLInputElement>(null);
	return (
		<div className="flex items-center">
			<input
				accept={ACCEPT_IMAGES}
				aria-label="Attach image"
				className="hidden"
				multiple
				onChange={(event) => {
					onFiles([...(event.target.files ?? [])]);
					event.target.value = "";
				}}
				ref={fileRef}
				type="file"
			/>
			<Button
				aria-label="Attach image"
				onClick={() => fileRef.current?.click()}
				size="icon"
				type="button"
				variant="ghost"
			>
				<ImagePlusIcon className="size-4" />
			</Button>
		</div>
	);
}

function ComposerToolbar({
	onFiles,
	onStop,
	streaming,
	toolsSlot,
}: {
	onFiles: (files: File[]) => void;
	onStop: () => void;
	streaming: boolean;
	toolsSlot?: ReactNode;
}) {
	return (
		<PromptInputToolbar>
			<PromptInputTools>
				<AttachButton onFiles={onFiles} />
				{toolsSlot}
			</PromptInputTools>
			<PromptInputSubmit
				onStop={onStop}
				status={streaming ? "streaming" : "idle"}
			/>
		</PromptInputToolbar>
	);
}

interface ChatComposerProps {
	agentClient: AgentClient;
	onSend: (text: string, attachments: AttachmentRef[]) => void;
	onStop: () => void;
	sessionId: string;
	streaming: boolean;
	/** App-provided extra control(s) in the composer toolbar (e.g. a tools popover). */
	toolsSlot?: ReactNode;
}

function useComposerState({
	agentClient,
	sessionId,
	streaming,
	onSend,
}: {
	agentClient: AgentClient;
	onSend: (text: string, attachments: AttachmentRef[]) => void;
	sessionId: string;
	streaming: boolean;
}) {
	const [text, setText] = useState("");
	const { items, addFiles, remove, clear } = usePendingAttachments(
		agentClient,
		sessionId
	);
	const uploading = items.some((it) => it.status === "uploading");
	const submit = () => {
		const trimmed = text.trim();
		const ready = readyAttachments(items);
		if (streaming || uploading || (trimmed === "" && ready.length === 0)) {
			return;
		}
		onSend(trimmed, ready);
		setText("");
		clear();
	};
	return { text, setText, items, addFiles, remove, submit };
}

export function ChatComposer({
	streaming,
	onSend,
	onStop,
	agentClient,
	sessionId,
	toolsSlot,
}: ChatComposerProps) {
	const { text, setText, items, addFiles, remove, submit } = useComposerState({
		agentClient,
		sessionId,
		streaming,
		onSend,
	});

	return (
		<div className="shrink-0 px-3 pb-4 sm:px-4">
			<div className="mx-auto w-full max-w-3xl">
				<PromptInput
					className="rounded-2xl border bg-background p-2 shadow-sm"
					onSubmit={submit}
				>
					<ChipRow items={items} onRemove={remove} />
					<PromptInputTextarea
						disabled={streaming}
						onChange={setText}
						onSubmit={submit}
						placeholder="Send a message…"
						value={text}
					/>
					<ComposerToolbar
						onFiles={addFiles}
						onStop={onStop}
						streaming={streaming}
						toolsSlot={toolsSlot}
					/>
				</PromptInput>
			</div>
		</div>
	);
}
