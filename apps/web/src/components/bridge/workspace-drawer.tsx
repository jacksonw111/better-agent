import { Button } from "@better-agent/ui/components/button";
import { PanelLeftIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

// The <md sidebar-collapse pattern shared by the /local workspace (session
// sidebar) and the Task Conversation page (run sidebar): an overlay drawer,
// the pane-header toggle that opens it, and the open/close/select-and-close
// state trio. Extracted from local-agent-workspace.tsx so the task page
// reuses the exact same mobile behavior instead of growing a parallel one.

/** <md: the sidebar collapses into this overlay drawer, toggled from the
 * content pane's header. A plain fixed panel (the ui package has no Sheet);
 * the backdrop is a real button so it closes by tap or keyboard. `w-4/5
 * max-w-72` keeps a tappable backdrop sliver even at 320px, and
 * `pb-safe-bottom` clears the home indicator under the sidebar's bottom
 * content (both host routes are immersive, so no dock reserves that space). */
export function MobileSidebarDrawer({
	children,
	closeLabel,
	onClose,
	open,
}: {
	children: ReactNode;
	/** The backdrop button's accessible name — e.g. "Close session list". */
	closeLabel: string;
	onClose: () => void;
	open: boolean;
}) {
	if (!open) {
		return null;
	}
	return (
		<div className="fixed inset-0 z-50 md:hidden">
			<button
				aria-label={closeLabel}
				className="absolute inset-0 bg-black/40"
				onClick={onClose}
				type="button"
			/>
			<div className="absolute inset-y-0 left-0 flex w-4/5 max-w-72 flex-col bg-background pb-safe-bottom shadow-lg">
				{children}
			</div>
		</div>
	);
}

/** The <md header button that opens the drawer — rendered into the session
 * workspace pane's `headerStart` slot by both hosts. */
export function SidebarDrawerToggle({
	label,
	onOpen,
}: {
	/** The toggle's accessible name — e.g. "Show sessions" / "Show runs". */
	label: string;
	onOpen: () => void;
}) {
	return (
		<Button
			aria-label={label}
			className="md:hidden"
			onClick={onOpen}
			size="icon-sm"
			variant="ghost"
		>
			<PanelLeftIcon className="size-4" />
		</Button>
	);
}

/** The <md drawer's open/close/select-and-close trio, packaged so each host's
 * layout component stays under the max-lines-per-function gate. */
export function useSidebarDrawer(onSelect: (id: string) => void) {
	const [open, setOpen] = useState(false);
	return {
		close: () => setOpen(false),
		open,
		select: (id: string) => {
			onSelect(id);
			setOpen(false);
		},
		show: () => setOpen(true),
	};
}
