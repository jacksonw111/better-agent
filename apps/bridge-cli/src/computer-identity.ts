import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// The Computer's durable identity (D1): the Ed25519 private key generated at
// pairing time plus the computerId the server issued for its public key.
// Losing this file means pairing again as a NEW Computer — there is no
// recovery path by design — so it is written owner-only (0600) under the
// user's home directory.

export interface ComputerIdentity {
	computerId: string;
	privateKeyPem: string;
	serverUrl: string;
}

/** Owner-only: the file contains the Computer's private key. */
const IDENTITY_FILE_MODE = 0o600;

export function defaultIdentityPath(): string {
	return join(homedir(), ".better-agent", "identity.json");
}

export interface IdentityFile {
	/** The stored identity, or null when the file doesn't exist yet. A file
	 * that exists but can't be parsed is an error, not null — silently
	 * re-pairing over a corrupt credential would orphan the old Computer. */
	load(): Promise<ComputerIdentity | null>;
	/** Like `load`, but a missing file is an error telling the user exactly
	 * how to pair this machine first. */
	loadOrFail(): Promise<ComputerIdentity>;
	save(identity: ComputerIdentity): Promise<void>;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function parseIdentity(raw: string, filePath: string): ComputerIdentity {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`Computer identity file is not valid JSON: ${filePath}`);
	}
	const { computerId, privateKeyPem, serverUrl } = (parsed ?? {}) as Record<
		string,
		unknown
	>;
	if (
		typeof computerId !== "string" ||
		typeof privateKeyPem !== "string" ||
		typeof serverUrl !== "string"
	) {
		throw new Error(
			`Computer identity file is missing computerId/privateKeyPem/serverUrl: ${filePath}`
		);
	}
	return { computerId, privateKeyPem, serverUrl };
}

export function createIdentityFile(
	filePath: string = defaultIdentityPath()
): IdentityFile {
	async function load(): Promise<ComputerIdentity | null> {
		let raw: string;
		try {
			raw = await readFile(filePath, "utf8");
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return null;
			}
			throw error;
		}
		return parseIdentity(raw, filePath);
	}

	return {
		load,
		loadOrFail: async () => {
			const identity = await load();
			if (identity === null) {
				throw new Error(
					`No computer identity found at ${filePath} — pair this machine first:\n` +
						"  agent-cli --client --pair <code> --server <url>\n" +
						"(get a pairing code from the web Computers page)"
				);
			}
			return identity;
		},
		save: async (identity) => {
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, `${JSON.stringify(identity, null, "\t")}\n`, {
				mode: IDENTITY_FILE_MODE,
			});
			// `writeFile`'s mode only applies on creation — enforce it on
			// overwrite too so the private key can never stay group/world-readable.
			await chmod(filePath, IDENTITY_FILE_MODE);
		},
	};
}
