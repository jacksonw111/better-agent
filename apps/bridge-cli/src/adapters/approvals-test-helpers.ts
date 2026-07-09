// Shared by approvals.test.ts and present-approval.test.ts — split out purely
// so both spec files (createApprovalRegistry/retractPendingApprovals vs
// presentApproval) can stay under the repo's 300-line file cap without
// duplicating this fixture.

import type { NormalizedEvent } from "../normalize/types";

export const APPROVAL_OPTIONS = [
	{ id: "allow", label: "Allow" },
	{ id: "deny", label: "Deny" },
];

export function createFakeEvents(): {
	events: { push(event: NormalizedEvent): void };
	pushed: NormalizedEvent[];
} {
	const pushed: NormalizedEvent[] = [];
	return { events: { push: (event) => pushed.push(event) }, pushed };
}
