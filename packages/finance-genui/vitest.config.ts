import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Most renderer tests opt into jsdom per-file via
		// `// @vitest-environment jsdom`; jsdom as the default keeps the pure
		// logic tests working too and needs no per-file override.
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["src/test-setup.ts"],
	},
});
