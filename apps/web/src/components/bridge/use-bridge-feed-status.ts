import {
	COMMAND_CATALOG_STATUS,
	type CommandCatalogDetail,
	parseCommandCatalogDetail,
} from "./bridge-command-catalog";
import type { StreamEvent } from "./bridge-events";
import {
	parseQueueUpdateDetail,
	QUEUE_UPDATE_STATUS,
	type QueueUpdateDetail,
} from "./bridge-queue-status";
import {
	parseSessionListDetail,
	SESSION_LIST_STATUS,
	type SessionListDetail,
} from "./bridge-session-list";
import {
	parseTurnUsageDetail,
	parseUsageUpdateDetail,
	type SessionReadyDetail,
	TURN_USAGE_STATUS,
	type TurnUsageDetail,
	USAGE_UPDATE_STATUS,
	type UsageUpdateDetail,
} from "./bridge-session-status";
import {
	parseStatusSnapshotDetail,
	STATUS_SNAPSHOT_STATUS,
	type StatusSnapshotDetail,
} from "./bridge-status-snapshot";
import {
	foldSessionReadyEvent,
	type SessionReadyFold,
	sessionReadyOf,
} from "./session-ready-fold";

// The feed reducer's curated-status folding, split out of use-bridge-feed.ts
// for the repo's max-lines-per-file gate: each merge's fresh tail is folded
// onto the prior details (latest wins per status kind) instead of rescanning
// the whole events array per render.

/** The curated per-status-kind slice of `FeedState` this module folds — the
 * reducer passes its whole state (structurally compatible) as `prev`. */
export interface StatusDetails {
	commandCatalog: CommandCatalogDetail | null;
	queueUpdate: QueueUpdateDetail | null;
	sessionList: SessionListDetail | null;
	sessionReady: SessionReadyDetail | null;
	sessionReadyFold: SessionReadyFold;
	statusSnapshot: StatusSnapshotDetail | null;
	turnUsage: TurnUsageDetail | null;
	usageUpdate: UsageUpdateDetail | null;
}

/** Derives `sessionReady` off the fold — keeping the PREVIOUS reference (and
 * the memos hanging off it) when the fold didn't move this pass. Split out of
 * `nextStatusDetails` for the complexity gate. */
function derivedSessionReady(
	prev: StatusDetails,
	fold: SessionReadyFold
): SessionReadyDetail | null {
	return fold === prev.sessionReadyFold
		? prev.sessionReady
		: sessionReadyOf(fold);
}

/** Folds the newly-merged events' curated status details onto the prior ones:
 * for each matching status kind the LATEST such event in `parsed` wins (events
 * are id-ascending), and a kind absent from this batch keeps its prior value.
 * Runs only over the fresh tail, so a session's whole append cost stays linear
 * rather than O(n²). */
export function nextStatusDetails(
	prev: StatusDetails,
	parsed: StreamEvent[]
): StatusDetails {
	let {
		commandCatalog,
		queueUpdate,
		sessionList,
		sessionReadyFold,
		statusSnapshot,
		turnUsage,
		usageUpdate,
	} = prev;
	for (const { event, id } of parsed) {
		if (event.kind !== "status") {
			continue;
		}
		// session_ready replaces the fold's base; permission_mode_changed /
		// model_changed stash id-tracked field patches — see
		// foldSessionReadyEvent (fix-caps-regression: a read-back can never
		// fabricate a partial sessionReady or touch its capability fields).
		const folded = foldSessionReadyEvent(sessionReadyFold, id, event);
		if (folded !== undefined) {
			sessionReadyFold = folded;
		} else if (event.status === TURN_USAGE_STATUS) {
			turnUsage = parseTurnUsageDetail(event.detail);
		} else if (event.status === USAGE_UPDATE_STATUS) {
			usageUpdate = parseUsageUpdateDetail(event.detail);
		} else if (event.status === SESSION_LIST_STATUS) {
			sessionList = parseSessionListDetail(event.detail);
		} else if (event.status === STATUS_SNAPSHOT_STATUS) {
			statusSnapshot = parseStatusSnapshotDetail(event.detail);
		} else if (event.status === QUEUE_UPDATE_STATUS) {
			queueUpdate = parseQueueUpdateDetail(event.detail);
		} else if (event.status === COMMAND_CATALOG_STATUS) {
			commandCatalog = parseCommandCatalogDetail(event.detail);
		}
	}
	return {
		commandCatalog,
		queueUpdate,
		sessionList,
		sessionReady: derivedSessionReady(prev, sessionReadyFold),
		sessionReadyFold,
		statusSnapshot,
		turnUsage,
		usageUpdate,
	};
}
