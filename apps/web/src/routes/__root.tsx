import { Toaster } from "@better-agent/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { createMiddleware } from "@tanstack/react-start";
import { evlogErrorHandler } from "evlog/nitro/v3";

import { AuthBoundary } from "@/components/auth-guard";
import type { orpc } from "@/utils/orpc";

import appCss from "../index.css?url";

export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

// Runs before paint (inline, blocking) so the `dark` class lands before the
// body renders — otherwise a stored dark preference flashes a light frame.
const THEME_INIT_SCRIPT = `(function () {
	try {
		var stored = localStorage.getItem("theme");
		var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
		var isDark = stored === "dark" || (stored !== "light" && prefersDark);
		document.documentElement.classList.toggle("dark", isDark);
	} catch (e) {}
})();`;

export const Route = createRootRouteWithContext<RouterAppContext>()({
	server: {
		middleware: [createMiddleware().server(evlogErrorHandler)],
	},

	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				// viewport-fit=cover makes env(safe-area-inset-*) resolve to real
				// device insets (0 without it) — the floating mobile dock relies on
				// it to clear the home indicator.
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{ title: "better-agent" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
		scripts: [{ children: THEME_INIT_SCRIPT }],
	}),

	component: RootDocument,
});

function RootDocument() {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<AuthBoundary />
				<Toaster richColors />
				<TanStackRouterDevtools position="bottom-left" />
				<ReactQueryDevtools buttonPosition="bottom-right" position="bottom" />
				<Scripts />
			</body>
		</html>
	);
}
