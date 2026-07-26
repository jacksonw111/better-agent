import { createFakePtySessionStore } from "@better-agent/agent/testing/fake-pty-session-store";

// The PTY pieces of a computer test rig (P25-A): the in-memory session store
// plus a `ptyRelay` stub that RECORDS the KILL frames endSession pushes, so a
// router test can assert what the CLI would have received.
export interface PtyKillRecord {
	computerId: string;
	frame: Uint8Array;
}

export function buildPtyRig() {
	const ptyKills: PtyKillRecord[] = [];
	return {
		ptyKills,
		ptyRelay: {
			sendToAgent(computerId: string, frame: Uint8Array) {
				ptyKills.push({ computerId, frame });
			},
		},
		ptySession: createFakePtySessionStore(),
	};
}
