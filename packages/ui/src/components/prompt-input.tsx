import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { useRef } from "react";

const MAX_TEXTAREA_PX = 200;

export function PromptInput({
	onSubmit,
	children,
	className,
}: {
	onSubmit: () => void;
	children: ReactNode;
	className?: string;
}) {
	return (
		<form
			className={cn("rounded-lg border bg-background p-2", className)}
			onSubmit={(event: FormEvent) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			{children}
		</form>
	);
}

/** Optional ARIA wiring for a caller that layers a combobox-style popup (e.g.
 * the bridge terminal's slash-command picker) on top of this plain textarea —
 * `undefined` when no such popup is open, so the textarea stays a bare
 * `aria-label="Message"` field the rest of the time. */
export interface PromptInputComboboxAria {
	activeDescendant?: string;
	controls: string;
}

/** The default Enter-to-submit / Shift+Enter-newline behavior, skipped
 * entirely when `onKeyDown` (a caller's own keyboard-nav layer, e.g. the
 * slash-command picker) reports the key as already handled. Pulled out of
 * `PromptInputTextarea` purely to keep that component under the repo's
 * max-lines-per-function gate. */
function handleTextareaKeyDown(
	event: KeyboardEvent<HTMLTextAreaElement>,
	onSubmit: () => void,
	onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
): void {
	if (onKeyDown?.(event)) {
		return;
	}
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		onSubmit();
	}
}

export function PromptInputTextarea({
	value,
	onChange,
	onSubmit,
	disabled,
	placeholder = "Type a message… (Enter to send)",
	comboboxAria,
	onKeyDown,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	disabled?: boolean;
	placeholder?: string;
	comboboxAria?: PromptInputComboboxAria;
	/** Runs before the default Enter-to-submit / Shift+Enter-newline handling;
	 * returning `true` marks the key as handled, skipping that default
	 * behavior entirely. Lets a caller layer its own keyboard nav (arrow
	 * keys, Enter-to-select, Escape) on top of this shared textarea. */
	onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}) {
	const ref = useRef<HTMLTextAreaElement | null>(null);
	const resize = () => {
		const el = ref.current;
		if (el) {
			el.style.height = "auto";
			el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
		}
	};
	return (
		<textarea
			aria-activedescendant={comboboxAria?.activeDescendant}
			aria-controls={comboboxAria?.controls}
			aria-label="Message"
			// 16px (text-base) below sm so iOS Safari doesn't auto-zoom the whole
			// page when the textarea is focused; desktop keeps the compact 14px.
			className="w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
			disabled={disabled}
			onChange={(event) => {
				onChange(event.target.value);
				resize();
			}}
			onKeyDown={(event) => handleTextareaKeyDown(event, onSubmit, onKeyDown)}
			placeholder={placeholder}
			ref={ref}
			role={comboboxAria ? "combobox" : undefined}
			rows={1}
			style={{ maxHeight: MAX_TEXTAREA_PX }}
			value={value}
		/>
	);
}

export function PromptInputToolbar({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-center justify-between pt-1">{children}</div>
	);
}

export function PromptInputTools({ children }: { children?: ReactNode }) {
	return <div className="flex items-center gap-1">{children}</div>;
}

export function PromptInputSubmit({
	status,
	onStop,
}: {
	status: "idle" | "streaming";
	onStop: () => void;
}) {
	if (status === "streaming") {
		return (
			<Button
				aria-label="Stop"
				onClick={onStop}
				size="icon-sm"
				type="button"
				variant="destructive"
			>
				<SquareIcon className="size-3.5" />
			</Button>
		);
	}
	return (
		<Button aria-label="Send" size="icon-sm" type="submit">
			<ArrowUpIcon className="size-4" />
		</Button>
	);
}
