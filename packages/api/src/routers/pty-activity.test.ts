import { expect, it } from "vitest";
import { ALICE, buildComputerRig } from "./computers-test-helpers";
import { pairComputer } from "./runs-test-helpers";

// Observability slice A: the pty router surfaces the fine-grained
// `activityState`/`activityStateAt` (persisted from the CLI's STATE frame) so
// the web dashboard can render a per-session status. Split from pty.test.ts to
// keep that file under the 300-line cap.

it("listSessions surfaces the fine-grained activity state", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const alice = rig.userClientFor(ALICE);
	const created = await alice.pty.createSession({
		agentKind: "claude-code",
		computerId,
	});

	// Fresh session: no state reported yet.
	const before = await alice.pty.listSessions({ computerId });
	expect(before.sessions[0]?.activityState).toBeNull();
	expect(before.sessions[0]?.activityStateAt).toBeNull();

	// After the CLI reports a STATE frame (persisted via the store).
	const at = new Date("2026-07-28T10:00:00.000Z");
	await rig.ptySession.setActivityState(created.sessionId, "working", at);
	const after = await alice.pty.listSessions({ computerId });
	expect(after.sessions[0]?.activityState).toBe("working");
	expect(after.sessions[0]?.activityStateAt?.getTime()).toBe(at.getTime());
});

it("getSession surfaces the fine-grained activity state", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const alice = rig.userClientFor(ALICE);
	const created = await alice.pty.createSession({
		agentKind: "claude-code",
		computerId,
	});
	const at = new Date("2026-07-28T12:00:00.000Z");
	await rig.ptySession.setActivityState(created.sessionId, "idle", at);

	const spec = await alice.pty.getSession({ sessionId: created.sessionId });
	expect(spec.activityState).toBe("idle");
	expect(spec.activityStateAt?.getTime()).toBe(at.getTime());
});
