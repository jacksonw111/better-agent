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
			className={cn(
				"rounded-xl border bg-background p-2 transition-[border-color,_box-shadow] duration-150 focus-within:border-ring/60",
				className
			)}
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
 * the "/" skill picker) on top of this plain textarea — `undefined` when no
 * such popup is open, so the textarea stays a bare `aria-label="Message"`
 * field the rest of the time. */
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

/** 28px square icon button (beautifului.dev control size) for composer
 * toolbars — color-only hover, press scales to 0.94. */
export function PromptInputIconButton({
	label,
	onClick,
	children,
	pressed,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
	pressed?: boolean;
}) {
	return (
		<button
			aria-label={label}
			aria-pressed={pressed}
			className={cn(
				"flex size-7 items-center justify-center rounded-lg transition-[background-color,_color,_transform] duration-150 active:scale-95",
				pressed
					? "bg-accent text-foreground"
					: "text-muted-foreground hover:bg-accent hover:text-foreground"
			)}
			onClick={onClick}
			type="button"
		>
			{children}
		</button>
	);
}

export function PromptInputSubmit({
	status,
	onStop,
	canSend = true,
}: {
	status: "idle" | "streaming";
	onStop: () => void;
	/** Colors the send button: ink inversion when sendable, muted gray when
	 * there's nothing to send (the button is also disabled then). */
	canSend?: boolean;
}) {
	if (status === "streaming") {
		return (
			<button
				aria-label="Stop"
				className="flex size-7 items-center justify-center rounded-lg bg-destructive text-white transition-[background-color,_transform] duration-200 hover:bg-destructive/90 active:scale-95"
				onClick={onStop}
				type="button"
			>
				<SquareIcon className="size-3" fill="currentColor" />
			</button>
		);
	}
	return (
		<button
			aria-label="Send"
			className={cn(
				"flex size-7 items-center justify-center rounded-lg transition-[background-color,_color,_transform] duration-200 enabled:active:scale-95",
				canSend
					? "bg-foreground text-background hover:bg-foreground/90"
					: "bg-secondary text-muted-foreground"
			)}
			disabled={!canSend}
			type="submit"
		>
			<ArrowUpIcon className="size-4" strokeWidth={2.4} />
		</button>
	);
}
