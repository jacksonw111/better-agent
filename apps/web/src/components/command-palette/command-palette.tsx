import {
	CommandDialog,
	CommandEmpty,
	CommandInput,
	CommandList,
} from "@better-agent/ui/components/command";
import { type KeyboardEvent, useEffect, useState } from "react";
import {
	type PalettePageId,
	RootCommandPage,
	SessionsCommandPage,
} from "./command-palette-pages";
import {
	setCommandPaletteOpen,
	toggleCommandPalette,
	useCommandPaletteState,
} from "./command-palette-store";

// P2-T3 (docs/local-agent-workspace-plan.md): the ⌘K command palette. Mounted
// once in the authed shell (auth-guard.tsx); open state lives in the module
// store so the workspace header's "⌘K" button can open it too. Pages are a
// small stack (cmdk's multi-page pattern): root → "sessions" today, files/
// commits sub-pages slot in at P4 by extending PalettePageId + one component.

/** ⌘K / Ctrl+K toggles the palette anywhere in the authed app. */
function useGlobalPaletteShortcut(): void {
	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				toggleCommandPalette();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);
}

/** The active page's contents — split out of `CommandPalette` purely to keep
 * it under the repo's max-lines-per-function gate. */
function PalettePage({
	onPush,
	onRun,
	page,
	query,
	workspace,
}: {
	onPush: (page: PalettePageId) => void;
	onRun: (action: () => void) => void;
	page: PalettePageId | undefined;
	query: string;
	workspace: Parameters<typeof RootCommandPage>[0]["workspace"];
}) {
	if (page === "sessions") {
		return (
			<SessionsCommandPage onRun={onRun} query={query} workspace={workspace} />
		);
	}
	return (
		<RootCommandPage onPush={onPush} onRun={onRun} workspace={workspace} />
	);
}

export function CommandPalette() {
	useGlobalPaletteShortcut();
	const { open, workspace } = useCommandPaletteState();
	const [pages, setPages] = useState<readonly PalettePageId[]>([]);
	const [query, setQuery] = useState("");
	const page = pages.at(-1);

	// Reset to the root page for the next open, whatever closed it.
	useEffect(() => {
		if (!open) {
			setPages([]);
			setQuery("");
		}
	}, [open]);

	const push = (next: PalettePageId) => {
		setPages((previous) => [...previous, next]);
		setQuery("");
	};
	const run = (action: () => void) => {
		action();
		setCommandPaletteOpen(false);
	};
	// cmdk's multi-page convention: Backspace on an empty query pops a page.
	const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Backspace" && query === "" && pages.length > 0) {
			event.preventDefault();
			setPages((previous) => previous.slice(0, -1));
		}
	};

	return (
		<CommandDialog onOpenChange={setCommandPaletteOpen} open={open}>
			<CommandInput
				onKeyDown={onInputKeyDown}
				onValueChange={setQuery}
				placeholder={
					page === "sessions" ? "Search sessions…" : "Type a command or search…"
				}
				value={query}
			/>
			<CommandList>
				<CommandEmpty>No results found.</CommandEmpty>
				<PalettePage
					onPush={push}
					onRun={run}
					page={page}
					query={query}
					workspace={workspace}
				/>
			</CommandList>
		</CommandDialog>
	);
}
