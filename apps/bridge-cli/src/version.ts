// The published version, for `-v`/`--version`. A STATIC json import so every
// bundler (bun --compile, tsdown, tsx) inlines the value at build time — a
// runtime `require("../package.json")` breaks in the bun-compiled standalone
// binary, which runs from bun's virtual FS (`/$bunfs/root`) where the file
// doesn't exist.
import pkg from "../package.json" with { type: "json" };

export const BRIDGE_CLI_VERSION: string = pkg.version;
