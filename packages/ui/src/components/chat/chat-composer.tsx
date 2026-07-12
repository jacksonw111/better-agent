import { Button } from "@better-agent/ui/components/button";
import {
	PromptInput,
	type PromptInputComboboxAria,
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
	type PendingAttachment,
	readyAttachments,
	usePendingAttachments,
} from "./chat-attachments";
import type { AttachmentRef } from "./chat-blocks";
import type { SkillPickerItem } from "./skill-picker";
import { SkillPickerList } from "./skill-picker-list";
import { type UseSkillPickerResult, useSkillPicker } from "./use-skill-picker";

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
	/** The agent's assigned skills (see `orpc.skills.listAssigned`) — feeds the
	 * "/" picker (see `use-skill-picker.ts`). `undefined` before they've
	 * loaded or when the agent has none, in which case the picker never opens. */
	skills?: SkillPickerItem[];
	streaming: boolean;
	/** App-provided extra control(s) in the composer toolbar (e.g. a tools popover). */
	toolsSlot?: ReactNode;
}

function useComposerState({
	agentClient,
	sessionId,
	skills,
	streaming,
	onSend,
}: {
	agentClient: AgentClient;
	onSend: (text: string, attachments: AttachmentRef[]) => void;
	sessionId: string;
	skills?: SkillPickerItem[];
	streaming: boolean;
}) {
	const [text, setText] = useState("");
	const picker = useSkillPicker({ setText, skills, text });
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
	return { text, setText, items, addFiles, remove, submit, picker };
}

/** `aria-activedescendant`/`aria-controls` wiring for the textarea while the
 * skill picker is open — a bare textarea (no combobox semantics) otherwise.
 * Mirrors comboboxAriaFor in the bridge terminal's composer. */
function comboboxAriaFor(
	picker: UseSkillPickerResult
): PromptInputComboboxAria | undefined {
	if (!picker.open) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		activeDescendant: picker.itemDomId(picker.activeIndex),
		controls: picker.listId,
	};
}

interface ComposerBoxProps {
	items: PendingAttachment[];
	onFiles: (files: File[]) => void;
	onRemove: (localId: string) => void;
	onStop: () => void;
	picker: UseSkillPickerResult;
	setText: (text: string) => void;
	streaming: boolean;
	submit: () => void;
	text: string;
	toolsSlot?: ReactNode;
}

/** The "/" skill picker (when open) stacked above the prompt input itself —
 * split out of `ChatComposer` purely to keep that component under the
 * repo's max-lines-per-function gate, same as `ComposerBox` in the bridge
 * terminal's composer. */
function ComposerBox({
	items,
	onFiles,
	onRemove,
	onStop,
	picker,
	setText,
	streaming,
	submit,
	text,
	toolsSlot,
}: ComposerBoxProps) {
	return (
		<div className="relative mx-auto max-w-3xl">
			{picker.open && (
				<SkillPickerList
					activeIndex={picker.activeIndex}
					itemDomId={picker.itemDomId}
					items={picker.items}
					listId={picker.listId}
					onHover={picker.setActiveIndex}
					onSelect={picker.select}
				/>
			)}
			<PromptInput
				className="rounded-2xl border bg-background p-2 shadow-sm"
				onSubmit={submit}
			>
				<ChipRow items={items} onRemove={onRemove} />
				<PromptInputTextarea
					comboboxAria={comboboxAriaFor(picker)}
					disabled={streaming}
					onChange={setText}
					onKeyDown={picker.handleKeyDown}
					onSubmit={submit}
					placeholder="Send a message…"
					value={text}
				/>
				<ComposerToolbar
					onFiles={onFiles}
					onStop={onStop}
					streaming={streaming}
					toolsSlot={toolsSlot}
				/>
			</PromptInput>
		</div>
	);
}

export function ChatComposer({
	streaming,
	onSend,
	onStop,
	agentClient,
	sessionId,
	skills,
	toolsSlot,
}: ChatComposerProps) {
	const { text, setText, items, addFiles, remove, submit, picker } =
		useComposerState({
			agentClient,
			sessionId,
			skills,
			streaming,
			onSend,
		});

	return (
		<div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-4 sm:px-4">
			<ComposerBox
				items={items}
				onFiles={addFiles}
				onRemove={remove}
				onStop={onStop}
				picker={picker}
				setText={setText}
				streaming={streaming}
				submit={submit}
				text={text}
				toolsSlot={toolsSlot}
			/>
		</div>
	);
}
