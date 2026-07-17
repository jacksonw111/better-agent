// Shared by the Files/Git/Shell pane empty states: the workspace's absolute
// path as a muted mono line, so an empty pane still says WHERE it is looking.
// Renders nothing when the host doesn't know the path (e.g. /local sessions,
// where the CLI's cwd isn't surfaced to the page) — the hint text alone
// remains the empty state.

/** Muted mono workspace-path line under a pane hint; null-safe. */
export function WorkspacePathNote({ path }: { path?: string | null }) {
	if (!path) {
		return null;
	}
	return (
		<p className="max-w-xs break-all font-mono text-muted-foreground/80 text-xs">
			{path}
		</p>
	);
}
