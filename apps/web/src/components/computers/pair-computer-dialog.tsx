import { COMPUTER_PAIRING_CODE_TTL_MS } from "@better-agent/agent/computer-ports";
import { env } from "@better-agent/env/web";
import { CopyAction } from "@better-agent/ui/components/actions";
import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { usePairingCodeMutation } from "./use-pairing-code";

const MS_PER_MINUTE = 60_000;
const PAIRING_CODE_TTL_MINUTES = COMPUTER_PAIRING_CODE_TTL_MS / MS_PER_MINUTE;

const CODE_CLASS =
	"block w-full overflow-x-auto whitespace-nowrap rounded-md bg-muted px-2.5 py-2 font-mono text-xs";

/** The one-time command a user runs on the machine they're pairing. Shared
 * with the tests so the rendered and copied command can never drift. */
export function pairingCommand(code: string): string {
	return `agent-cli --client --pair ${code} --server ${env.VITE_SERVER_URL}`;
}

function PairingCommand({
	code,
	onRegenerate,
}: {
	code: string;
	onRegenerate: () => void;
}) {
	const command = pairingCommand(code);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-1.5">
				<code className={CODE_CLASS}>{command}</code>
				<CopyAction label="Copy command" text={command} />
			</div>
			<p className="text-muted-foreground text-xs">
				The code is shown only once and expires in {PAIRING_CODE_TTL_MINUTES}{" "}
				minutes — each machine you pair needs its own one-time code.
			</p>
			<p className="text-muted-foreground text-xs">
				Once the command finishes, the computer appears in the list within a few
				seconds. To pair another machine, generate a new code.
			</p>
			<Button
				className="self-start"
				onClick={onRegenerate}
				size="sm"
				type="button"
				variant="outline"
			>
				Generate new code
			</Button>
		</div>
	);
}

function PairDialogBody({
	code,
	failed,
	onRetry,
}: {
	code: string | undefined;
	failed: boolean;
	onRetry: () => void;
}) {
	if (code !== undefined) {
		return <PairingCommand code={code} onRegenerate={onRetry} />;
	}
	if (failed) {
		return (
			<div className="flex flex-col items-start gap-2">
				<p className="text-muted-foreground text-sm">
					Couldn't generate a pairing code.
				</p>
				<Button onClick={onRetry} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	return <Skeleton className="h-9 w-full" />;
}

/**
 * "Pair new computer": generates a one-time pairing code on open and shows
 * the ready-to-run `agent-cli --client --pair …` command. Self-contained —
 * it owns its trigger button and open state, so the list can drop it into
 * the toolbar or the empty state without wiring.
 */
export function PairComputerDialog() {
	const [open, setOpen] = useState(false);
	const create = usePairingCodeMutation((message) => toast.error(message));

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) {
			create.mutate(undefined);
		} else {
			create.reset();
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				Pair new computer
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader className="gap-1.5">
					<DialogTitle>Pair new computer</DialogTitle>
					<DialogDescription>
						Run this command on the computer you want to pair.
					</DialogDescription>
				</DialogHeader>
				<PairDialogBody
					code={create.data?.code}
					failed={create.isError}
					onRetry={() => create.mutate(undefined)}
				/>
				<DialogFooter>
					<Button
						onClick={() => onOpenChange(false)}
						type="button"
						variant="outline"
					>
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
