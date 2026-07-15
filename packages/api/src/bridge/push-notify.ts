import type { BridgeSessionRow, PushPayload } from "@better-agent/agent/ports";
import { log } from "evlog";
import type { Context } from "../context";

// P3-T3 (docs/local-agent-workspace-plan.md §P3-3): Web Push fan-out off the
// event-ingest path. Every relayed batch (oRPC pushEvents AND the WS events
// frame both funnel through ingestEvents) is scanned for the three
// notification-worthy moments — an open approval/question, a completed turn
// (claude's `turn_usage` status), and an error — and at most one push per
// session per moment-type fires per THROTTLE_MS. The caller invokes this
// fire-and-forget; `notifyPushForBatch` itself never throws, so a push
// failure can never break the live relay.

/** The three notification-worthy moments, keyed into the throttle map and
 * the notification `tag` (so a newer push replaces a stale one in the OS
 * notification tray instead of stacking). */
type PushMoment = "approval" | "turn" | "error";

/** Minimum gap between two pushes of the same moment-type for one session —
 * a busy agent emitting many errors/turns shouldn't buzz the phone nonstop. */
const THROTTLE_MS = 60_000;

/** Safety valve on the in-process throttle map (long-lived Node): once it
 * grows past this many session×moment entries, drop them all — worst case a
 * few sessions get one extra push, which beats unbounded growth. */
const THROTTLE_MAP_MAX = 10_000;

/** `${sessionId}:${moment}` → epoch ms of the last push sent. In-memory on
 * purpose: the relay WS and this hook live on the same long-lived process. */
const lastPushAt = new Map<string, number>();

/** Test hook: clears the module-level throttle between test cases. */
export function resetPushNotifyThrottleForTests(): void {
	lastPushAt.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Which notification-worthy moment (if any) one relayed event represents.
 * Mirrors session-attention.ts's read of the event union (bridge-events.ts):
 * a `cancelled` approval/question is a retraction, not a new request. */
function classify(event: unknown): PushMoment | null {
	if (!isRecord(event)) {
		return null;
	}
	if (
		(event.kind === "approval" || event.kind === "question") &&
		event.cancelled !== true
	) {
		return "approval";
	}
	if (event.kind === "status" && event.status === "turn_usage") {
		return "turn";
	}
	return event.kind === "error" ? "error" : null;
}

/** Consumes one send slot for (sessionId, moment): true when a push may fire
 * now, false while still inside the throttle window. */
function takeSendSlot(sessionId: string, moment: PushMoment): boolean {
	const key = `${sessionId}:${moment}`;
	const now = Date.now();
	const last = lastPushAt.get(key);
	if (last !== undefined && now - last < THROTTLE_MS) {
		return false;
	}
	if (lastPushAt.size >= THROTTLE_MAP_MAX) {
		lastPushAt.clear();
	}
	lastPushAt.set(key, now);
	return true;
}

const MOMENT_TEXT: Record<PushMoment, { title: string; body: string }> = {
	approval: { title: "需要审批", body: "有待处理的审批/提问" },
	turn: { title: "回合完成", body: "已完成一个回合" },
	error: { title: "出错了", body: "报告了一个错误" },
};

function buildPayload(
	session: BridgeSessionRow,
	moment: PushMoment
): PushPayload {
	const agentLabel = session.name ?? session.label ?? session.agentKind;
	const text = MOMENT_TEXT[moment];
	return {
		title: text.title,
		body: `${agentLabel}：${text.body}`,
		url: `/local/${session.tokenId}?session=${session.id}`,
		tag: `${session.id}-${moment}`,
	};
}

/** Scans one ingested batch and fires the due pushes. Never throws (callers
 * run it fire-and-forget off the ingest path); the session read only happens
 * when a moment actually cleared the throttle, so a quiet batch costs one
 * bounded scan and nothing else. */
export async function notifyPushForBatch(
	context: Context,
	sessionId: string,
	events: unknown[]
): Promise<void> {
	const push = context.services.push;
	if (!push) {
		return;
	}
	try {
		const moments = new Set<PushMoment>();
		for (const event of events) {
			const moment = classify(event);
			if (moment) {
				moments.add(moment);
			}
		}
		const due = [...moments].filter((m) => takeSendSlot(sessionId, m));
		if (due.length === 0) {
			return;
		}
		const session = await context.services.stores.bridgeSession.get(sessionId);
		if (!session) {
			return;
		}
		for (const moment of due) {
			await push.sender.sendToUser(
				session.userId,
				buildPayload(session, moment)
			);
		}
	} catch (err) {
		log.warn({ action: "bridge push notify", error: String(err) });
	}
}
