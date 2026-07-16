import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["./src/index.ts", "./src/migrate.ts", "./src/seed-skills.ts"],
	format: "esm",
	outDir: "./dist",
	clean: true,
	noExternal: [/@better-agent\/.*/],
});
