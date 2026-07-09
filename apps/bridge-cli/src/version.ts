import { createRequire } from "node:module";

// Read from package.json instead of hardcoding so `-v`/`--version` never
// drifts from the published version. `createRequire(import.meta.url)`
// resolves correctly both under tsx (this file lives at src/version.ts) and
// in the bundled dist/index.mjs (tsdown inlines this module, so
// import.meta.url there points at dist/index.mjs) — both sit exactly one
// level below the package root, where package.json lives.
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export const BRIDGE_CLI_VERSION: string = version;
