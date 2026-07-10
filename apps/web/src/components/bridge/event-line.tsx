import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@better-agent/ui/components/card";
import {
	AlertTriangleIcon,
	CheckIcon,
	FileEditIcon,
	InfoIcon,
} from "lucide-react";
import type {
	ApprovalEvent,
	ErrorEvent,
	FileEvent,
	StatusEvent,
} from "./bridge-events";

const DEFAULT_OPTION_INDEX = 0;

const FILE_CHANGE_LABEL: Record<FileEvent["change"], string> = {
	created: "+",
	modified: "~",
	deleted: "-",
};

export function FileLine({ event }: { event: FileEvent }) {
	return (
		<p className="flex items-center gap-1.5">
			<FileEditIcon className="size-3.5 shrink-0 text-muted-foreground" />
			<Badge variant="outline">
				{FILE_CHANGE_LABEL[event.change]} {event.path}
			</Badge>
		</p>
	);
}

export function StatusLine({ event }: { event: StatusEvent }) {
	return (
		<p className="flex items-center gap-1.5 text-muted-foreground italic">
			<InfoIcon className="size-3.5 shrink-0" />
			{event.status}
		</p>
	);
}

export function ErrorLine({ event }: { event: ErrorEvent }) {
	return (
		<p className="flex items-center gap-1.5 text-destructive">
			<AlertTriangleIcon className="size-3.5 shrink-0" />
			{event.message}
		</p>
	);
}

export interface ApprovalLineProps {
	answeredOptionId?: string;
	event: ApprovalEvent;
	onAnswer?: (requestId: string, optionId: string) => void;
}

/**
 * Approval request card: title + optional detail + one button per option.
 * The first option is the "allow"-style default action, the rest render as
 * outline buttons. Once `answeredOptionId` is set — either from this
 * session's own click (optimistically, before the round trip settles — see
 * `makeAnswerApproval`) or a replayed event for an already-answered
 * `requestId` — THIS card's buttons disable and the chosen one shows a check.
 * Disabling is per-card (keyed by `requestId`), deliberately NOT gated on the
 * connection's global "sending" flag: that flag flips for any send, so gating
 * on it greyed out every open approval card when the user answered one.
 */
export function ApprovalLine({
	answeredOptionId,
	event,
	onAnswer,
}: ApprovalLineProps) {
	const disabled = answeredOptionId !== undefined;
	return (
		<Card className="gap-2 font-sans" size="sm">
			<CardHeader>
				<CardTitle>{event.title}</CardTitle>
				{event.detail && <CardDescription>{event.detail}</CardDescription>}
			</CardHeader>
			<CardContent className="flex flex-wrap gap-2">
				{event.options.map((option, index) => {
					const chosen = answeredOptionId === option.id;
					return (
						<Button
							disabled={disabled}
							key={option.id}
							onClick={() => onAnswer?.(event.requestId, option.id)}
							size="sm"
							type="button"
							variant={index === DEFAULT_OPTION_INDEX ? "default" : "outline"}
						>
							{chosen && <CheckIcon className="size-3.5" />}
							{option.label}
							{chosen && <span className="sr-only"> (chosen)</span>}
						</Button>
					);
				})}
			</CardContent>
		</Card>
	);
}
