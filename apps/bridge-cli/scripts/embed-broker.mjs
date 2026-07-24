#!/usr/bin/env node
// Embeds a cross-compiled pty-broker binary into src/pty/broker-asset.ts as
// base64, so `bun build --compile` carries it inside the standalone CLI.
//
// Usage:
//   node scripts/embed-broker.mjs <target> <broker-binary-path>
//   node scripts/embed-broker.mjs --restore
//
// `<target>` is a label like "darwin-arm64" recorded alongside the payload.
// `--restore` rewrites the empty committed placeholder so the working tree /
// dev+test runs go back to disk-resolved brokers.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assetPath = join(here, "..", "src", "pty", "broker-asset.ts");

const HEADER = `// Embedded pty-broker binary, base64-encoded.
//
// This file is a COMMITTED PLACEHOLDER. \`scripts/embed-broker.mjs\` overwrites it
// with the real broker bytes (cross-compiled for the target) right before
// \`bun build --compile\`, so the standalone binary carries its own broker with no
// external files. The \`--restore\` mode rewrites this placeholder afterwards, so
// the working tree stays clean and dev/test runs (tsx / vitest) see an empty
// payload and resolve a broker from disk instead (see resolve-broker.ts).
//
// Base64 (not a Bun \`with { type: "file" }\` import) is deliberate: it is
// runtime-agnostic, so the exact same module works under Bun, Node, and vitest.
`;

function render(b64, target) {
	return `${HEADER}
/** Base64 of the target's pty-broker executable, or "" in a dev/test checkout. */
export const BROKER_B64 = "${b64}";

/** The broker's compile target (e.g. "darwin-arm64"), or "" when unembedded. */
export const BROKER_TARGET = "${target}";
`;
}

const [, , arg1, arg2] = process.argv;

if (arg1 === "--restore") {
	writeFileSync(assetPath, render("", ""));
	process.stdout.write("embed-broker: restored placeholder\n");
} else if (arg1 && arg2) {
	const bytes = readFileSync(arg2);
	const b64 = bytes.toString("base64");
	writeFileSync(assetPath, render(b64, arg1));
	process.stdout.write(
		`embed-broker: embedded ${bytes.length} bytes for ${arg1} (${b64.length} b64 chars)\n`
	);
} else {
	process.stderr.write(
		"usage: embed-broker.mjs <target> <broker-path> | --restore\n"
	);
	process.exit(2);
}
