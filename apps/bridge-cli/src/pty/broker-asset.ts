// Embedded pty-broker binary, base64-encoded.
//
// This file is a COMMITTED PLACEHOLDER. `scripts/embed-broker.mjs` overwrites it
// with the real broker bytes (cross-compiled for the target) right before
// `bun build --compile`, so the standalone binary carries its own broker with no
// external files. The `--restore` mode rewrites this placeholder afterwards, so
// the working tree stays clean and dev/test runs (tsx / vitest) see an empty
// payload and resolve a broker from disk instead (see resolve-broker.ts).
//
// Base64 (not a Bun `with { type: "file" }` import) is deliberate: it is
// runtime-agnostic, so the exact same module works under Bun, Node, and vitest.

/** Base64 of the target's pty-broker executable, or "" in a dev/test checkout. */
export const BROKER_B64 = "";

/** The broker's compile target (e.g. "darwin-arm64"), or "" when unembedded. */
export const BROKER_TARGET = "";
