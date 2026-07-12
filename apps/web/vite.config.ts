import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

// react-pdf / pdfjs reference browser-only globals (DOMMatrix, …) at module
// eval, which crashes the SPA-shell prerender (a Node/Workers SSR pass). The
// PDF viewer only ever loads react-pdf via a dynamic import inside a browser
// effect, so on the SSR build we swap it for a harmless stub — the client build
// still resolves the real modules.
const SSR_STUBBED = new Set(["react-pdf", "pdfjs-dist"]);
const PDF_STUB_ID = "\0virtual:pdf-ssr-stub";

function stubPdfOnSsr(): Plugin {
	return {
		name: "stub-pdf-on-ssr",
		// `pre` so this wins over the framework/nitro resolvers, which otherwise
		// resolve react-pdf to the real module before this hook runs.
		enforce: "pre",
		resolveId(id, _importer, options) {
			// Stub in every non-client build (ssr / prerender / nitro server).
			// `options.ssr` alone misses some envs, so key off the name too.
			const envName = this.environment?.name;
			const isServerBuild =
				options?.ssr === true ||
				(envName !== undefined && envName !== "client");
			return isServerBuild && SSR_STUBBED.has(id) ? PDF_STUB_ID : null;
		},
		load(id) {
			if (id === PDF_STUB_ID) {
				return "export const Document = () => null; export const Page = () => null; export const pdfjs = { GlobalWorkerOptions: {}, version: '0' }; export default {};";
			}
			return null;
		},
	};
}

export default defineConfig({
	server: {
		port: 3001,
	},
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [
		stubPdfOnSsr(),
		tailwindcss(),
		// SPA mode: prerender a static shell and let the client do all data
		// fetching. The frontends run as their own Cloudflare Worker and cannot
		// reach the API Worker via a server-to-server fetch during SSR, so we
		// avoid SSR data loading entirely.
		tanstackStart({ spa: { enabled: true } }),
		nitro(),
		viteReact(),
	],
});
