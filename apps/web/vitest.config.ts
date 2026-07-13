import { defineConfig } from "vitest/config";

export default defineConfig({
	// Mirrors vite.config.ts's resolve so tests can use the same "@/..." /
	// "@better-agent/ui/..." aliases as the app — without this, any test that
	// imports a module reaching for those paths (even transitively) fails to
	// resolve under vitest, which runs standalone from the app's dev server.
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["src/test-setup.ts"],
	},
});
