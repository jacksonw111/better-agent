import { Button } from "@better-agent/ui/components/button";
import { Loader2Icon, RotateCwIcon } from "lucide-react";
import { useState } from "react";

// Split out of terminal-header.tsx purely to keep that file under the repo's
// max-lines-per-file gate.

/** The Restart button: asks the CLI to tear down and relaunch under the same
 * sessionId (R3), tracking its own in-flight state locally since `restart`
 * itself is a plain async trigger (mirrors `StatusSnapshotPanel`'s refresh
 * button — see status-snapshot-panel.tsx). */
export function RestartSessionButton({
	restart,
}: {
	restart: () => Promise<void>;
}) {
	const [pending, setPending] = useState(false);

	const handleRestart = async (): Promise<void> => {
		setPending(true);
		try {
			await restart();
		} finally {
			setPending(false);
		}
	};

	return (
		<Button
			aria-label="Restart local agent session"
			disabled={pending}
			onClick={() => handleRestart()}
			size="icon-sm"
			title="Restart local agent session"
			variant="ghost"
		>
			{pending ? (
				<Loader2Icon className="size-4 animate-spin" />
			) : (
				<RotateCwIcon className="size-4" />
			)}
		</Button>
	);
}
