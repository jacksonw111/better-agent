import type { Dispatch } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import type { FeedAction } from "./use-bridge-feed";

// Split out of use-bridge-terminal.ts purely to keep that file under the
// repo's max-lines-per-file gate: the approval-decision callback and the
// detail page's session-control callbacks (interrupt/setModel/
// setPermissionMode/listSessions) both relay through the same `sendRaw`
// primitive that hook already builds.

const APPROVAL_SEND_FAILURE_MESSAGE =
	"Couldn't send that decision — try again.";

/**
 * Builds the approval-decision callback: marks it answered in the feed
 * store immediately (so the buttons disable and the chosen option shows
 * before the network round trip settles — no window for a double-click to
 * send twice), then relays the decision as the `{ type: "approval",
 * requestId, optionId }` command object the CLI's `commands.ts` parses back
 * out. This must go over the wire as an object, not a JSON string — the
 * CLI's `parseCommandText` treats any string as plain chat text (the string
 * check runs first), so a stringified approval would be typed into the
 * agent instead of routed to `answerApproval` and the approval would stall
 * forever. If the send rejects, the optimistic mark is rolled back —
 * approvals gate destructive operations, so a decision that never reached
 * the agent must not sit there looking answered — and a toast surfaces the
 * failure so the user knows to retry. Not itself a hook — takes the
 * dispatch/sendRaw a hook already produced.
 */
export function makeAnswerApproval(
	dispatchFeed: Dispatch<FeedAction>,
	sendRaw: (data: unknown) => Promise<void>
) {
	return async (requestId: string, optionId: string): Promise<void> => {
		dispatchFeed({ type: "answer", requestId, optionId });
		try {
			await sendRaw({ type: "approval", requestId, optionId });
		} catch (error) {
			dispatchFeed({ type: "unanswer", requestId });
			const message =
				error instanceof Error ? error.message : APPROVAL_SEND_FAILURE_MESSAGE;
			toast.error(message);
		}
	};
}

const QUESTION_SEND_FAILURE_MESSAGE = "Couldn't send that answer — try again.";

/**
 * R3-T3: mirrors `makeAnswerApproval` for a `question` turn — marks it
 * answered in the feed store immediately (optimistic disable), then relays
 * `{ type: "control", action: "answerQuestion", requestId, answers }`, the
 * shape `apps/bridge-cli/src/commands-question.ts`'s
 * `parseAnswerQuestionCommand` parses back out. Rolled back on send failure,
 * same fail-safe reasoning as `makeAnswerApproval`.
 */
export function makeAnswerQuestion(
	dispatchFeed: Dispatch<FeedAction>,
	sendRaw: (data: unknown) => Promise<void>
) {
	return async (requestId: string, answers: string[][]): Promise<void> => {
		dispatchFeed({ type: "answerQuestion", requestId, answers });
		try {
			await sendRaw({
				type: "control",
				action: "answerQuestion",
				requestId,
				answers,
			});
		} catch (error) {
			dispatchFeed({ type: "unanswerQuestion", requestId });
			const message =
				error instanceof Error ? error.message : QUESTION_SEND_FAILURE_MESSAGE;
			toast.error(message);
		}
	};
}

const CONTROL_SEND_FAILURE_MESSAGE = "Couldn't send that — try again.";

/** One send for the detail page's session controls (interrupt/setModel/
 * setPermissionMode/listSessions): relays `{ type: "control", action,
 * ...extra }` over the same `sendRaw` path `makeAnswerApproval` uses — an
 * object, never a stringified one, for the same reason approvals must go
 * over as objects (see that function's doc). Unlike a chat send, there's no
 * feed echo and no optimistic local state to roll back; a failure just
 * toasts. */
function sendControlCommand(
	sendRaw: (data: unknown) => Promise<void>,
	action: string,
	extra?: Record<string, unknown>
): Promise<void> {
	return sendRaw({ type: "control", action, ...extra }).catch((error) => {
		const message =
			error instanceof Error ? error.message : CONTROL_SEND_FAILURE_MESSAGE;
		toast.error(message);
	});
}

const RESTART_FAILURE_MESSAGE = "Couldn't restart the agent — try again.";

/** Restart is NOT a `{ type: "control", ... }` message relayed over this
 * connection's own `sendRaw` channel like interrupt/setModel/etc — it's the
 * distinct `bridge.restartSession` server procedure (R3), which appends the
 * restart command to the session's relay directly from the server side (see
 * packages/api/src/routers/bridge-restart.ts) so it works even if this tab's
 * own SSE/poll connection is degraded. Called as a plain client request
 * (not a `useMutation`) so this hook stays usable without a
 * QueryClientProvider ancestor — same catch-and-toast shape as
 * `sendControlCommand` above. */
function restartSession(sessionId: string): Promise<void> {
	return orpc.bridge.restartSession.call({ sessionId }).then(
		() => undefined,
		(error: unknown) => {
			const message =
				error instanceof Error ? error.message : RESTART_FAILURE_MESSAGE;
			toast.error(message);
		}
	);
}

export interface SessionControls {
	/** Asks the agent for its current status (model/context/cost/tokens/mcp/
	 * running) — fire-and-forget like `listSessions`, the reply arrives
	 * asynchronously as a `status_snapshot` status event (see
	 * bridge-status-snapshot.ts). */
	getStatus: () => Promise<void>;
	interrupt: () => Promise<void>;
	listSessions: () => Promise<void>;
	/** Asks the CLI to tear down and relaunch under the same sessionId (R3) —
	 * the detail page's Restart button. See `restartSession` above. */
	restart: () => Promise<void>;
	setModel: (model: string) => Promise<void>;
	setPermissionMode: (mode: string) => Promise<void>;
	/** Switches the reasoning-effort level for subsequent turns — the
	 * composer's Thinking picker (pi's `set_thinking_level`, R2-T3 item 2).
	 * Routed as `{ type: "control", action: "setThinking", level }`, mirroring
	 * `setModel`/`setPermissionMode` (see `apps/bridge-cli/src/commands.ts`). */
	setThinking: (level: string) => Promise<void>;
}

/** Builds the detail page's session-control callbacks (Interrupt/model
 * picker/permission-mode dropdown/past-conversations request/status
 * refresh/restart) atop `sendControlCommand` (plus the standalone `restart`
 * request). Split out purely to keep `useBridgeTerminal` itself under the
 * repo's max-lines-per-function gate. */
export function useSessionControls(
	sendRaw: (data: unknown) => Promise<void>,
	sessionId: string
): SessionControls {
	return {
		interrupt: () => sendControlCommand(sendRaw, "interrupt"),
		setModel: (model: string) =>
			sendControlCommand(sendRaw, "setModel", { model }),
		setPermissionMode: (mode: string) =>
			sendControlCommand(sendRaw, "setPermissionMode", { mode }),
		setThinking: (level: string) =>
			sendControlCommand(sendRaw, "setThinking", { level }),
		listSessions: () => sendControlCommand(sendRaw, "listSessions"),
		getStatus: () => sendControlCommand(sendRaw, "getStatus"),
		restart: () => restartSession(sessionId),
	};
}
