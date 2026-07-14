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
// The genui tool registry imports the vault-backed PdfLink at module top (to
// inject it into finance cards). That pulls the PDF drawer's dep graph (radix
// focus-guards → a default-`import`-of-`tslib` with broken CJS interop) into
// the SSR-shell prerender's eager module graph, where it throws at module-eval
// ("Cannot destructure '__extends' of __toESM(...).default") — no page is
// prerendered, `_shell.html` is never written, the Docker build fails. The
// static SPA shell renders no tool results, so PdfLink is stubbed on SSR.
const PDF_LINK_SPECIFIER = "@/components/pdf/pdf-link";
const PDF_LINK_STUB_ID = "\0virtual:pdf-link-ssr-stub";
// The ⌘K command palette (cmdk) is mounted in the authed shell and imported at
// module top. cmdk's dep graph does a default-`import` of `tslib` with broken
// CJS interop that throws at SSR module-eval (same `__extends` failure as the
// PDF drawer), killing the SPA-shell prerender. The palette is a client-only
// keyboard affordance never present on the static shell, so it's stubbed on SSR.
const COMMAND_PALETTE_SPECIFIER =
	"@/components/command-palette/command-palette";
const COMMAND_PALETTE_STUB_ID = "\0virtual:command-palette-ssr-stub";

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
			if (!isServerBuild) {
				return null;
			}
			if (id === PDF_LINK_SPECIFIER) {
				return PDF_LINK_STUB_ID;
			}
			if (id === COMMAND_PALETTE_SPECIFIER) {
				return COMMAND_PALETTE_STUB_ID;
			}
			return SSR_STUBBED.has(id) ? PDF_STUB_ID : null;
		},
		load(id) {
			if (id === PDF_STUB_ID) {
				return "export const Document = () => null; export const Page = () => null; export const pdfjs = { GlobalWorkerOptions: {}, version: '0' }; export default {};";
			}
			if (id === PDF_LINK_STUB_ID) {
				return "export const PdfLink = () => null; export default {};";
			}
			if (id === COMMAND_PALETTE_STUB_ID) {
				return "export const CommandPalette = () => null; export default {};";
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
		// fetching. The frontend ships as a static SPA served by its Node/Docker
		// container, so SSR data loading is deliberately skipped. (SSR is now
		// technically possible — the API is reachable server-side — but left off;
		// revisit in the performance pass if it's worth it.)
		tanstackStart({ spa: { enabled: true } }),
		nitro(),
		viteReact(),
	],
});
