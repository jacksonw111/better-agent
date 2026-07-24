// Resolves the pty-broker executable path at runtime.
//
// Resolution order:
//   1. `BETTER_AGENT_PTY_BROKER` env override — an absolute path to a broker
//      binary. Used by tests (point at a locally-compiled broker) and by anyone
//      who wants to swap the binary without rebuilding.
//   2. The embedded base64 payload (`broker-asset.ts`) — unpacked once to
//      `~/.better-agent/pty-broker-<target>-<hash>`, chmod 0o755, then reused.
//      This is the path taken by the compiled standalone CLI.
//   3. Otherwise throw — a dev/test checkout with no embed and no override must
//      say so loudly rather than spawn something surprising.

import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BROKER_B64, BROKER_TARGET } from "./broker-asset";

const BROKER_MODE = 0o755;

/** Env var holding an absolute path to a broker binary (overrides the embed). */
export const BROKER_ENV_OVERRIDE = "BETTER_AGENT_PTY_BROKER";

/** Where unpacked brokers live; content-hashed so a CLI upgrade never reuses a
 * stale binary and concurrent CLIs of the same version share one file. */
function brokerCacheDir(): string {
	return join(homedir(), ".better-agent");
}

let cachedPath: string | undefined;

/** Unpacks the embedded broker to a stable, content-addressed path (idempotent)
 * and returns it. Throws if nothing is embedded. */
function unpackEmbeddedBroker(): string {
	if (cachedPath !== undefined) {
		return cachedPath;
	}
	if (BROKER_B64.length === 0) {
		throw new Error(
			`No pty-broker available: this build has no embedded broker and ${BROKER_ENV_OVERRIDE} is unset. ` +
				"In a dev/test checkout, compile native/pty-broker.c and set " +
				`${BROKER_ENV_OVERRIDE} to its path.`
		);
	}
	const bytes = Buffer.from(BROKER_B64, "base64");
	const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
	const target = BROKER_TARGET.length > 0 ? BROKER_TARGET : "unknown";
	const dir = brokerCacheDir();
	const path = join(dir, `pty-broker-${target}-${hash}`);
	// Reuse an intact prior unpack (right size) to avoid rewriting every launch.
	if (existsSync(path) && statSync(path).size === bytes.length) {
		chmodSync(path, BROKER_MODE);
		cachedPath = path;
		return path;
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(path, bytes, { mode: BROKER_MODE });
	chmodSync(path, BROKER_MODE);
	cachedPath = path;
	return path;
}

/** Returns an absolute path to a runnable pty-broker, or throws with guidance. */
export function resolveBrokerPath(): string {
	const override = process.env[BROKER_ENV_OVERRIDE];
	if (override !== undefined && override.length > 0) {
		return override;
	}
	return unpackEmbeddedBroker();
}
