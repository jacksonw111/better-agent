// Computer domain port types + constants (S1-T1), a sibling of
// bridge-token-ports.ts kept out of ports.ts for the 300-line limit. A
// Computer is a user's paired machine running the CLI in client mode: it is
// identified by an Ed25519 keypair (server stores the public key, the client
// keeps the private key in ~/.better-agent/identity.json) and reports what it
// can run (runtime inventory) and which managed tools are installed.

import type { BridgeAgentKind } from "./bridge-token-ports";

/** How often a client-mode CLI reports a heartbeat to the server. */
export const COMPUTER_HEARTBEAT_INTERVAL_MS = 10_000;
/** A Computer with no heartbeat for this long is shown as Offline. */
export const COMPUTER_OFFLINE_AFTER_MS = 30_000;
/** One-time pairing codes expire this long after creation (10 minutes). */
export const COMPUTER_PAIRING_CODE_TTL_MS = 600_000;

/** A skill discovered on the Computer (e.g. ~/.claude/skills/<name>/SKILL.md). */
export interface SkillSummary {
	description: string;
	name: string;
}

/** Whether a runtime on the Computer supports skill discovery: claude-code is
 * `discoverable`; runtimes with no skill system report `none` and never
 * produce skill references. */
export type ComputerSkillCapability = "none" | "discoverable";

/** One runtime the Computer detected on PATH, with its skill capability and
 * (when discoverable) the skills found for it. */
export interface ComputerRuntimeInventoryItem {
	agentKind: BridgeAgentKind;
	skillCapability: ComputerSkillCapability;
	skills: SkillSummary[];
}

/** Managed tools the platform cares about (installed-or-not facts only —
 * authentication is never preflighted). */
export type ManagedToolName = "git" | "gh";

export interface ManagedToolInventoryItem {
	installed: boolean;
	name: ManagedToolName;
}

/** A queued control-channel command a Computer picks up via the heartbeat
 * fallback path (D4). Slice 1 always returns an empty list; Slice 2 fills it
 * with launch commands awaiting ack. */
export interface ComputerPendingCommand {
	kind: "launch";
	runId: string;
}

/** What the client sends when a Computer registers (first pair or a
 * re-register of the same identity, which only refreshes attributes). */
export interface ComputerRegistrationInput {
	arch: string | null;
	clientVersion: string | null;
	name: string;
	platform: string | null;
	publicKeyPem: string;
	runtimeInventory: ComputerRuntimeInventoryItem[];
	toolInventory: ManagedToolInventoryItem[];
	userId: string;
}

export interface ComputerRow extends ComputerRegistrationInput {
	createdAt: Date;
	id: string;
	lastSeenAt: Date;
	updatedAt: Date;
}

/** Attribute + inventory refresh on re-register: inventories are always
 * replaced whole; the plain attributes only change when provided. */
export interface ComputerInventoryUpdate {
	arch?: string | null;
	clientVersion?: string | null;
	name?: string;
	platform?: string | null;
	runtimeInventory: ComputerRuntimeInventoryItem[];
	toolInventory: ManagedToolInventoryItem[];
}

export interface ComputerStore {
	/** Atomically consumes an unexpired, unused pairing code (sets used_at) —
	 * null when the hash is unknown, already used, or expired at `now`. */
	consumePairingCode(
		codeHash: string,
		now: Date
	): Promise<{ userId: string } | null>;
	createPairingCode(input: {
		userId: string;
		codeHash: string;
		expiresAt: Date;
	}): Promise<void>;
	/** Owner-scoped delete; false when the row isn't the caller's. */
	deleteById(id: string, userId: string): Promise<boolean>;
	/** Includes publicKeyPem so callers can verify request signatures. */
	getById(id: string): Promise<ComputerRow | null>;
	insert(input: ComputerRegistrationInput): Promise<ComputerRow>;
	listByUser(userId: string): Promise<ComputerRow[]>;
	/** Heartbeat: records lastSeenAt; false when the Computer is unknown. */
	touch(id: string, lastSeenAt: Date): Promise<boolean>;
	updateInventory(
		id: string,
		update: ComputerInventoryUpdate
	): Promise<boolean>;
}
