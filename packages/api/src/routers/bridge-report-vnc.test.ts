import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, BOB, build } from "./bridge-test-helpers";

// Split out of bridge.test.ts (which is at the repo's 300-line-per-file gate)
// — the `--cua` reportVnc endpoint's owner-scoped set/clear behavior.

it("reportVnc sets the session's vncEndpoint the owner can see, and clears it", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	await cli.bridge.reportVnc({
		sessionId,
		vncEndpoint: "vnc://127.0.0.1:5901",
	});
	const alice = userClientFor(ALICE);
	const withVnc = (await alice.bridge.listSessions()).find(
		(s) => s.id === sessionId
	);
	expect(withVnc?.vncEndpoint).toBe("vnc://127.0.0.1:5901");

	await cli.bridge.reportVnc({ sessionId, vncEndpoint: null });
	const cleared = (await alice.bridge.listSessions()).find(
		(s) => s.id === sessionId
	);
	expect(cleared?.vncEndpoint).toBeNull();
});

it("reportVnc rejects a non-owner bridge token with NOT_FOUND", async () => {
	const { bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	const otherCli = bridgeClientFor({ tokenId: "tok-2", userId: BOB.id });
	await expect(
		otherCli.bridge.reportVnc({ sessionId, vncEndpoint: "x" })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});
