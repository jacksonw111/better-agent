// Internal session-credential pre-issuance (S2-T2, design D4). Every Run gets
// a dedicated bridge token minted at creation time (S2-T3 calls this): the
// existing session relay is reused wholesale, but the token is an internal
// implementation detail — named `task:<taskId>`, never surfaced in any user
// UI. The raw token is persisted (like user-created bridge tokens) because
// the Launch payload is built later, at delivery time, not at creation.

import type {
	BridgeAgentKind,
	BridgeTokenConfig,
	BridgeTokenStore,
} from "../bridge-token-ports";
import { generateToken, hashToken } from "../crypto/auth-tokens";

const SESSION_CREDENTIAL_PREFIX = "bt_";
const LAST4_LENGTH = 4;

export interface RunSessionCredentialDeps {
	bridgeTokenStore: Pick<BridgeTokenStore, "create">;
}

export interface RunSessionCredentialInput {
	agentKind: BridgeAgentKind;
	/** Startup config persisted onto the minted token, which the CLI reads back
	 * via `startSession` and hands the adapter as `opts.config`. `tasks.resume`
	 * sets `model`/`permissionMode` here so the continuation launches on the
	 * same ones the previous run ended on (see tasks-resume.ts). */
	config?: BridgeTokenConfig;
	taskId: string;
	userId: string;
}

export interface RunSessionCredential {
	/** Raw `bt_…` token — becomes the Launch payload's `sessionCredential`. */
	token: string;
	/** Stored on the Run as `sessionTokenId` (migration 0046). */
	tokenId: string;
}

export function createRunSessionCredential(deps: RunSessionCredentialDeps) {
	return async (
		input: RunSessionCredentialInput
	): Promise<RunSessionCredential> => {
		const token = generateToken(SESSION_CREDENTIAL_PREFIX);
		const created = await deps.bridgeTokenStore.create({
			userId: input.userId,
			name: `task:${input.taskId}`,
			agentKind: input.agentKind,
			token,
			tokenHash: hashToken(token),
			last4: token.slice(-LAST4_LENGTH),
			config: input.config,
		});
		return { token, tokenId: created.id };
	};
}
