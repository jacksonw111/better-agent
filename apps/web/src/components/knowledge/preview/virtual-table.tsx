import { cn } from "@better-agent/ui/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

// Row-virtualized data table for CSV/XLSX previews: only the visible window
// of rows is in the DOM, so tens of thousands of parsed rows scroll at 60fps.

const ROW_HEIGHT = 30;
const OVERSCAN = 12;

function Cells({ cells, header }: { cells: string[]; header?: boolean }) {
	return (
		<>
			{cells.map((cell, index) => (
				<div
					className={cn(
						"w-40 shrink-0 truncate border-border/60 border-b px-2 py-1.5 text-xs",
						header
							? "font-medium text-muted-foreground"
							: "text-foreground tabular-nums"
					)}
					// biome-ignore lint/suspicious/noArrayIndexKey: cells are positional columns with no identity
					key={index}
					title={cell}
				>
					{cell}
				</div>
			))}
		</>
	);
}

/** `rows[0]` renders as the sticky header row. */
export function VirtualTable({
	note,
	rows,
}: {
	note?: string;
	rows: string[][];
}) {
	const parentRef = useRef<HTMLDivElement>(null);
	const bodyRows = rows.slice(1);
	const virtualizer = useVirtualizer({
		count: bodyRows.length,
		estimateSize: () => ROW_HEIGHT,
		getScrollElement: () => parentRef.current,
		overscan: OVERSCAN,
	});
	return (
		<div className="flex h-full flex-col">
			<div className="min-h-0 flex-1 overflow-auto" ref={parentRef}>
				<div className="sticky top-0 z-10 flex w-max min-w-full bg-background">
					<Cells cells={rows[0] ?? []} header />
				</div>
				<div
					className="relative w-max min-w-full"
					style={{ height: virtualizer.getTotalSize() }}
				>
					{virtualizer.getVirtualItems().map((item) => (
						<div
							className="absolute top-0 left-0 flex w-max min-w-full"
							key={item.key}
							style={{ transform: `translateY(${item.start}px)` }}
						>
							<Cells cells={bodyRows[item.index] ?? []} />
						</div>
					))}
				</div>
			</div>
			{note ? (
				<p className="px-3 py-2 text-muted-foreground text-xs">{note}</p>
			) : null}
		</div>
	);
}
