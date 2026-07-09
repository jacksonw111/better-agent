import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export function Reasoning({
	isStreaming,
	children,
	className,
}: {
	isStreaming: boolean;
	children: ReactNode;
	className?: string;
}) {
	const [open, setOpen] = useState(isStreaming);
	// Auto-open while streaming, auto-close when done.
	useEffect(() => {
		setOpen(isStreaming);
	}, [isStreaming]);
	return (
		<Collapsible.Root
			className={cn("rounded-md border bg-muted/40 p-2", className)}
			onOpenChange={setOpen}
			open={open}
		>
			{children}
		</Collapsible.Root>
	);
}

export function ReasoningTrigger({ label }: { label: string }) {
	return (
		<Collapsible.Trigger className="flex w-full items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground">
			<BrainIcon className="size-3.5" />
			<span>{label}</span>
			<ChevronDownIcon className="ml-auto size-3.5 transition-transform data-[panel-open]:rotate-180" />
		</Collapsible.Trigger>
	);
}

export function ReasoningContent({ children }: { children: ReactNode }) {
	return (
		<Collapsible.Panel className="mt-2 text-muted-foreground text-xs leading-relaxed">
			{children}
		</Collapsible.Panel>
	);
}
