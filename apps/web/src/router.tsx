import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { ErrorPage } from "./components/error-page";
import { routeTree } from "./routeTree.gen";
import { createQueryClient, orpc } from "./utils/orpc";

// The router's error boundary is the one legitimate place to log an
// uncaught render/loader error — the UI itself shows no raw error text.
function logRouterError(error: unknown) {
	// biome-ignore lint/suspicious/noConsole: error boundary is the legitimate exception to the console ban
	console.error(error);
}

function RouterErrorComponent({ error }: { error: unknown }) {
	logRouterError(error);
	return <ErrorPage />;
}

// A deploy swaps the hashed chunk graph; an already-open tab then fails its
// next lazy import (the old chunk 404s). Vite surfaces that as
// `vite:preloadError` — reload once to pick up the new build instead of
// stranding the tab on a dead chunk graph. Guarded so a reload loop is
// impossible within one pageload.
const RELOADED_FLAG = "ba-chunk-reload";
if (typeof window !== "undefined") {
	window.addEventListener("vite:preloadError", (event) => {
		if (sessionStorage.getItem(RELOADED_FLAG) === "1") {
			return; // Second failure on the fresh build — let the error surface.
		}
		sessionStorage.setItem(RELOADED_FLAG, "1");
		event.preventDefault();
		window.location.reload();
	});
	window.addEventListener("load", () =>
		sessionStorage.removeItem(RELOADED_FLAG)
	);
}

export const getRouter = () => {
	const queryClient = createQueryClient();

	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreloadStaleTime: 0,
		context: { orpc, queryClient },
		defaultNotFoundComponent: () => <div>Not Found</div>,
		defaultErrorComponent: RouterErrorComponent,
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient,
	});

	return router;
};

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
