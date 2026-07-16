import {
	COMPUTER_OFFLINE_AFTER_MS,
	COMPUTER_PAIRING_CODE_TTL_MS,
	type ComputerRow,
} from "@better-agent/agent/computer-ports";
import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { buildPendingLaunchCommands } from "../computers/pending-commands";
import {
	authorizedUserProcedure,
	computerProcedure,
	publicProcedure,
} from "../index";

// Computers router (S1-T2): `pair` is the public one-time-code entry point;
// `register`/`heartbeat` are computer-plane (signed x-ba-* headers via
// computerProcedure); createPairingCode/list/delete are owner-scoped user
// routes. Connected is computed here from lastSeenAt — never stored — and
// list strips publicKeyPem.

const AGENT_KINDS = ["claude-code", "opencode", "codex", "pi"] as const;
const NAME_MAX_LENGTH = 120;
const ATTRIBUTE_MAX_LENGTH = 40;
const SKILL_DESCRIPTION_MAX_LENGTH = 2000;
const PUBLIC_KEY_PEM_MAX_LENGTH = 1000;
const PAIRING_CODE_MAX_LENGTH = 128;
const PAIRING_CODE_PREFIX = "pc_";

const skillSummaryInput = z.object({
	description: z.string().max(SKILL_DESCRIPTION_MAX_LENGTH),
	name: z.string().min(1).max(NAME_MAX_LENGTH),
});

const runtimeInventoryItemInput = z.object({
	agentKind: z.enum(AGENT_KINDS),
	skillCapability: z.enum(["none", "discoverable"]),
	skills: z.array(skillSummaryInput),
});

const toolInventoryItemInput = z.object({
	installed: z.boolean(),
	name: z.enum(["git", "gh"]),
});

const attributesInputShape = {
	arch: z.string().trim().min(1).max(ATTRIBUTE_MAX_LENGTH),
	clientVersion: z.string().trim().min(1).max(ATTRIBUTE_MAX_LENGTH),
	name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
	platform: z.string().trim().min(1).max(ATTRIBUTE_MAX_LENGTH),
	runtimeInventory: z.array(runtimeInventoryItemInput),
	toolInventory: z.array(toolInventoryItemInput),
};

// Public by design: the one-time code IS the credential. An unknown, expired
// or already-used code is the same UNAUTHORIZED — no oracle.
const pair = publicProcedure
	.input(
		z.object({
			...attributesInputShape,
			code: z.string().min(1).max(PAIRING_CODE_MAX_LENGTH),
			publicKeyPem: z.string().min(1).max(PUBLIC_KEY_PEM_MAX_LENGTH),
		})
	)
	.handler(async ({ input, context }) => {
		const consumed = await context.services.stores.computer.consumePairingCode(
			hashToken(input.code),
			new Date()
		);
		if (!consumed) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "Invalid or expired pairing code",
			});
		}
		const computer = await context.services.stores.computer.insert({
			arch: input.arch,
			clientVersion: input.clientVersion,
			name: input.name,
			platform: input.platform,
			publicKeyPem: input.publicKeyPem,
			runtimeInventory: input.runtimeInventory,
			toolInventory: input.toolInventory,
			userId: consumed.userId,
		});
		return { computerId: computer.id };
	});

// Re-register of an already paired identity: refresh attributes + replace
// inventories whole, and count it as a liveness signal.
const register = computerProcedure
	.input(z.object(attributesInputShape))
	.handler(async ({ input, context }) => {
		const { computer } = context;
		await context.services.stores.computer.updateInventory(computer.id, input);
		await context.services.stores.computer.touch(computer.id, new Date());
		return { ok: true };
	});

// `pendingCommands` is the no-WS fallback delivery path for control-channel
// commands (D4, S2-T2): the Computer's still-`created` Runs rendered as
// Launch payloads — identical to what /computer-ws pushes, so a Computer
// without a live WS still launches within one heartbeat interval (≤10s).
const heartbeat = computerProcedure.handler(async ({ context }) => {
	await context.services.stores.computer.touch(context.computer.id, new Date());
	const pendingCommands = await buildPendingLaunchCommands(
		context.services.stores,
		context.computer
	);
	return { ok: true, pendingCommands };
});

// The raw code is returned exactly once; only its sha256 is stored.
const createPairingCode = authorizedUserProcedure.handler(
	async ({ context }) => {
		const code = generateToken(PAIRING_CODE_PREFIX);
		const expiresAt = new Date(Date.now() + COMPUTER_PAIRING_CODE_TTL_MS);
		await context.services.stores.computer.createPairingCode({
			codeHash: hashToken(code),
			expiresAt,
			userId: context.authedUser.id,
		});
		return { code, expiresAt };
	}
);

// Explicit field list (not rest-spread) so the sensitive publicKeyPem can
// never leak into the list response by accident.
function toListedComputer(row: ComputerRow, nowMs: number) {
	return {
		arch: row.arch,
		clientVersion: row.clientVersion,
		connected: nowMs - row.lastSeenAt.getTime() <= COMPUTER_OFFLINE_AFTER_MS,
		createdAt: row.createdAt,
		id: row.id,
		lastSeenAt: row.lastSeenAt,
		name: row.name,
		platform: row.platform,
		runtimeInventory: row.runtimeInventory,
		toolInventory: row.toolInventory,
	};
}

const list = authorizedUserProcedure.handler(async ({ context }) => {
	const rows = await context.services.stores.computer.listByUser(
		context.authedUser.id
	);
	const nowMs = Date.now();
	return rows.map((row) => toListedComputer(row, nowMs));
});

const deleteComputer = authorizedUserProcedure
	.input(z.object({ id: z.uuid() }))
	.handler(async ({ input, context }) => {
		const deleted = await context.services.stores.computer.deleteById(
			input.id,
			context.authedUser.id
		);
		if (!deleted) {
			throw new ORPCError("NOT_FOUND", { message: "Computer not found" });
		}
		return { ok: true };
	});

export const computersRouter = {
	createPairingCode,
	delete: deleteComputer,
	heartbeat,
	list,
	pair,
	register,
};
