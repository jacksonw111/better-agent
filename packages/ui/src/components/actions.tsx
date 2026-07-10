import { Button } from "@better-agent/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@better-agent/ui/components/tooltip";
import { cn } from "@better-agent/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

const COPIED_RESET_MS = 1500;

export function Actions({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex items-center gap-1", className)}>{children}</div>
	);
}

export function Action({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label={label}
						className="text-muted-foreground hover:text-foreground"
						onClick={onClick}
						size="icon-xs"
						type="button"
						variant="ghost"
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

export function CopyAction({
	text,
	label = "Copy",
}: {
	text: string;
	label?: string;
}) {
	const [copied, setCopied] = useState(false);
	return (
		<Action
			label={label}
			onClick={() => {
				navigator.clipboard.writeText(text).then(
					() => {
						setCopied(true);
						setTimeout(() => setCopied(false), COPIED_RESET_MS);
					},
					() => {
						// clipboard blocked (non-secure context / no permission): no-op
					}
				);
			}}
		>
			<span className="t-icon-swap" data-state={copied ? "b" : "a"}>
				<CopyIcon className="t-icon size-3.5" data-icon="a" />
				<CheckIcon className="t-icon size-3.5" data-icon="b" />
			</span>
		</Action>
	);
}
