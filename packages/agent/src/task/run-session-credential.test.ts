import { expect, it } from "vitest";
import type { BridgeTokenRow, BridgeTokenStore } from "../bridge-token-ports";
import { hashToken } from "../crypto/auth-tokens";
import { createRunSessionCredential } from "./run-session-credential";

// S2-T2: internal session-credential pre-issuance (design D4) — a bridge
// token minted per Run at creation time (S2-T3 calls this), named
// `task:<taskId>` and never shown in any user UI.

type CreateInput = Parameters<BridgeTokenStore["create"]>[0];

const LAST4_SLICE = -4;

function capturingTokenStore(created: CreateInput[]) {
	return {
		create(input: CreateInput): Promise<BridgeTokenRow> {
			created.push(input);
			return Promise.resolve({
				id: "token-1",
				userId: input.userId,
				name: input.name ?? null,
				agentKind: input.agentKind,
				token: input.token,
				last4: input.last4 ?? null,
				config: input.config ?? null,
				createdAt: new Date(),
				revokedAt: null,
			});
		},
	};
}

it("mints a bt_ token named task:<taskId> bound to the run's agent kind", async () => {
	const created: CreateInput[] = [];
	const issue = createRunSessionCredential({
		bridgeTokenStore: capturingTokenStore(created),
	});

	const credential = await issue({
		agentKind: "opencode",
		taskId: "task-42",
		userId: "alice-uid",
	});

	expect(credential.tokenId).toBe("token-1");
	expect(credential.token.startsWith("bt_")).toBe(true);
	const input = created[0];
	expect(input?.name).toBe("task:task-42");
	expect(input?.agentKind).toBe("opencode");
	expect(input?.userId).toBe("alice-uid");
	// The raw token is persisted so the Launch payload can be built later,
	// and the hash is what the relay's bearer auth resolves against.
	expect(input?.token).toBe(credential.token);
	expect(input?.tokenHash).toBe(hashToken(credential.token));
	expect(input?.last4).toBe(credential.token.slice(LAST4_SLICE));
});

it("mints a distinct credential per call", async () => {
	const created: CreateInput[] = [];
	const issue = createRunSessionCredential({
		bridgeTokenStore: capturingTokenStore(created),
	});
	const first = await issue({
		agentKind: "claude-code",
		taskId: "t1",
		userId: "u1",
	});
	const second = await issue({
		agentKind: "claude-code",
		taskId: "t1",
		userId: "u1",
	});
	expect(first.token).not.toBe(second.token);
});
