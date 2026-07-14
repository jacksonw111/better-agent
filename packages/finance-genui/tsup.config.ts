import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	// .d.ts is emitted separately by `tsc -p tsconfig.dts.json` (see the build
	// script). tsup's bundled dts step injects a deprecated `baseUrl` (TS5101
	// under TS 6) and is slow on the ~150-file React tree, so we let tsc do it.
	dts: false,
	// Keep the lazy chart chunks (recharts / lightweight-charts backed) in their
	// own split chunks so importing the package does NOT eagerly pull in charts.
	splitting: true,
	treeshake: true,
	sourcemap: true,
	clean: true,
	// react/react-dom are peers; runtime deps (recharts, lightweight-charts,
	// motion, lucide-react, cva, clsx, tailwind-merge) are externalized by tsup
	// from `dependencies`/`peerDependencies` — consumers install them.
	external: ["react", "react-dom"],
	// Copy the CSS token file next to the built entry.
	onSuccess: "cp src/styles.css dist/styles.css",
});
