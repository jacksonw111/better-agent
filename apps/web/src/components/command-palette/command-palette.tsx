import {
	CommandDialog,
	CommandEmpty,
	CommandInput,
	CommandList,
} from "@better-agent/ui/components/command";
import { useEffect, useState } from "react";
import { RootCommandPage } from "./command-palette-pages";
import {
	setCommandPaletteOpen,
	toggleCommandPalette,
	useCommandPaletteState,
} from "./command-palette-store";

// The ⌘K command palette. Mounted once in the authed shell (auth-guard.tsx);
// open state lives in the module store so buttons elsewhere can open it too.

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

export function CommandPalette() {
	useGlobalPaletteShortcut();
	const { open } = useCommandPaletteState();
	const [query, setQuery] = useState("");

	// Reset the query for the next open, whatever closed it.
	useEffect(() => {
		if (!open) {
			setQuery("");
		}
	}, [open]);

	const run = (action: () => void) => {
		action();
		setCommandPaletteOpen(false);
	};

	return (
		<CommandDialog onOpenChange={setCommandPaletteOpen} open={open}>
			<CommandInput
				onValueChange={setQuery}
				placeholder="Type a command or search…"
				value={query}
			/>
			{/* <sm: dvh cap (index.css) keeps results above the keyboard. */}
			<CommandList className="max-h-palette-list">
				<CommandEmpty>No results found.</CommandEmpty>
				<RootCommandPage onRun={run} />
			</CommandList>
		</CommandDialog>
	);
}
