import { Button } from "@better-agent/ui/components/button";
import { useState } from "react";
import { toast } from "sonner";
import type { BridgeTransport } from "./bridge-transport";
import { VncViewer } from "./vnc-viewer";

type VmAction = "startVm" | "stopVm";

function useVmCommand(sessionId: string, transport: BridgeTransport) {
	const [busy, setBusy] = useState(false);
	const send = async (action: VmAction) => {
		setBusy(true);
		try {
			await transport.sendInput({
				sessionId,
				data: { type: "control", action },
			});
			toast.success(
				action === "startVm" ? "Starting desktop…" : "Stopping desktop…"
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Command failed");
		} finally {
			setBusy(false);
		}
	};
	return { busy, send };
}

function DesktopHeader({
	active,
	busy,
	onSend,
}: {
	active: boolean;
	busy: boolean;
	onSend: (action: VmAction) => void;
}) {
	return (
		<div className="flex items-center justify-between">
			<span className="font-medium text-sm">Remote desktop</span>
			{active ? (
				<Button
					disabled={busy}
					onClick={() => onSend("stopVm")}
					size="sm"
					variant="outline"
				>
					Stop desktop
				</Button>
			) : (
				<Button disabled={busy} onClick={() => onSend("startVm")} size="sm">
					Start desktop
				</Button>
			)}
		</div>
	);
}

/** The `--cua` remote-desktop controls on the Local Agent detail page: a
 * Start/Stop button that relays a `control: startVm` / `stopVm` command to the
 * CLI, plus the live VNC when a desktop is up. Rendered only for sessions the
 * caller has seen expose a VNC endpoint (i.e. `agent-cli --cua`). */
export function RemoteDesktopPanel({
	sessionId,
	vncEndpoint,
	transport,
}: {
	sessionId: string;
	transport: BridgeTransport;
	vncEndpoint: string | null;
}) {
	const { busy, send } = useVmCommand(sessionId, transport);
	const active = Boolean(vncEndpoint);
	return (
		<div className="flex flex-col gap-2">
			<DesktopHeader active={active} busy={busy} onSend={send} />
			{active ? (
				<VncViewer key={sessionId} sessionId={sessionId} />
			) : (
				<p className="rounded-md border border-dashed p-4 text-muted-foreground text-sm">
					Desktop stopped. Start it to watch and control the VM.
				</p>
			)}
		</div>
	);
}
