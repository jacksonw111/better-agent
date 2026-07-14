import type { BridgeSessionRow } from "@better-agent/agent/ports";
import { Button } from "@better-agent/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { VncViewer } from "@/components/bridge/vnc-viewer";
import { client, orpc } from "@/utils/orpc";

// TEMPORARY remote-control debug page (test-only). Reuses existing bridge infra
// — VncViewer + bridge.listSessions/observe/sendInput — with zero new
// components or server routes, so it can be deleted by removing just this file.
// Reach it at /debug/remote.

export const Route = createFileRoute("/debug/remote")({
	component: DebugRemotePage,
});

const POLL_MS = 1500;
const MAX_LOG_EVENTS = 200;

interface LogEvent {
	data: unknown;
	id: number;
}

function SessionPicker({
	sessions,
	selectedId,
	onSelect,
}: {
	onSelect: (id: string) => void;
	selectedId: string | null;
	sessions: BridgeSessionRow[];
}) {
	if (sessions.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No bridge sessions. Start a Local Agent first.
			</p>
		);
	}
	return (
		<label className="flex flex-col gap-1 text-sm">
			<span className="font-medium">Session</span>
			<select
				className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
				onChange={(e) => onSelect(e.target.value)}
				value={selectedId ?? ""}
			>
				<option value="">— pick a session —</option>
				{sessions.map((s) => (
					<option key={s.id} value={s.id}>
						{s.label ?? s.id} · {s.agentKind} · {s.status}
						{s.vncEndpoint ? " · VNC" : ""}
					</option>
				))}
			</select>
		</label>
	);
}

function InstructionSender({ sessionId }: { sessionId: string }) {
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const send = async () => {
		const trimmed = text.trim();
		if (!trimmed) {
			return;
		}
		setBusy(true);
		try {
			// Bare string == a plain prompt the CLI's parseCommandText accepts.
			await client.bridge.sendInput({ sessionId, data: trimmed });
			setText("");
			toast.success("Instruction sent");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Send failed");
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="flex flex-col gap-2">
			<span className="font-medium text-sm">Send instruction (prompt)</span>
			<textarea
				className="min-h-16 w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm"
				onChange={(e) => setText(e.target.value)}
				placeholder="e.g. list the files in the current directory"
				value={text}
			/>
			<Button
				className="w-fit"
				disabled={busy || text.trim() === ""}
				onClick={send}
				size="sm"
				type="button"
			>
				Send
			</Button>
		</div>
	);
}

function RawCommandSender({ sessionId }: { sessionId: string }) {
	const [json, setJson] = useState('{ "type": "getStatus" }');
	const [busy, setBusy] = useState(false);
	const send = async () => {
		let data: unknown;
		try {
			data = JSON.parse(json);
		} catch {
			toast.error("Invalid JSON");
			return;
		}
		setBusy(true);
		try {
			await client.bridge.sendInput({ sessionId, data });
			toast.success("Command sent");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Send failed");
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="flex flex-col gap-2">
			<span className="font-medium text-sm">Run raw command (JSON)</span>
			<textarea
				className="min-h-16 w-full resize-y rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
				onChange={(e) => setJson(e.target.value)}
				value={json}
			/>
			<Button
				className="w-fit"
				disabled={busy}
				onClick={send}
				size="sm"
				type="button"
				variant="outline"
			>
				Run command
			</Button>
		</div>
	);
}

function useEventLog(sessionId: string): LogEvent[] {
	const [events, setEvents] = useState<LogEvent[]>([]);
	const afterId = useRef(0);
	useEffect(() => {
		setEvents([]);
		afterId.current = 0;
		let active = true;
		const tick = async () => {
			try {
				const batch = await client.bridge.observe({
					sessionId,
					afterId: afterId.current,
				});
				if (!active || batch.length === 0) {
					return;
				}
				afterId.current = Math.max(afterId.current, ...batch.map((e) => e.id));
				setEvents((prev) => [...prev, ...batch].slice(-MAX_LOG_EVENTS));
			} catch {
				// Debug page: swallow transient poll errors.
			}
		};
		const timer = setInterval(tick, POLL_MS);
		tick();
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [sessionId]);
	return events;
}

function EventLog({ sessionId }: { sessionId: string }) {
	const events = useEventLog(sessionId);
	return (
		<div className="flex flex-col gap-2">
			<span className="font-medium text-sm">Live events ({events.length})</span>
			<div className="h-64 overflow-auto rounded-md border bg-muted/30 p-2">
				{events.length === 0 ? (
					<p className="text-muted-foreground text-xs">Waiting for events…</p>
				) : (
					events.map((e) => (
						<pre
							className="whitespace-pre-wrap break-all border-border/40 border-b py-1 text-xs last:border-b-0"
							key={e.id}
						>
							{`#${e.id} ${JSON.stringify(e.data)}`}
						</pre>
					))
				)}
			</div>
		</div>
	);
}

function SessionPanel({ session }: { session: BridgeSessionRow }) {
	return (
		<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<div className="flex flex-col gap-3">
				<span className="font-medium text-sm">Live VNC</span>
				{/* Always attempt the viewer: nothing writes `vncEndpoint` yet, and a
				    session with a running `agent-cli --cua` producer pairs by id
				    regardless. With no producer attached it just shows "Connecting…". */}
				<VncViewer sessionId={session.id} />
				<EventLog sessionId={session.id} />
			</div>
			<div className="flex flex-col gap-6">
				<InstructionSender sessionId={session.id} />
				<RawCommandSender sessionId={session.id} />
			</div>
		</div>
	);
}

function DebugRemotePage() {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const sessionsQuery = useQuery(orpc.bridge.listSessions.queryOptions());
	const sessions = sessionsQuery.data?.sessions ?? [];
	const selected = sessions.find((s) => s.id === selectedId) ?? null;
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
			<div className="flex flex-col gap-1">
				<h1 className="font-semibold text-lg">Remote control · debug</h1>
				<p className="text-muted-foreground text-sm">
					Temporary test page for the remote-control feature — live VNC,
					instructions, and raw commands against a bridge session.
				</p>
			</div>
			<SessionPicker
				onSelect={setSelectedId}
				selectedId={selectedId}
				sessions={sessions}
			/>
			{selected ? (
				<SessionPanel session={selected} />
			) : (
				<p className="text-muted-foreground text-sm">
					Pick a session to begin.
				</p>
			)}
		</div>
	);
}
