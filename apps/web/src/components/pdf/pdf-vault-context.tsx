"use client";

import {
	createContext,
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { proxyPdfUrl } from "./proxy-pdf-url";

// The drawer pulls in vaul + react-pdf + pdfjs (which references browser-only
// globals like DOMMatrix at module-eval time). Lazy-load it so none of that is
// in the SSR module graph — it only loads in the browser, the first time a user
// actually opens a PDF.
const importPdfDrawer = () => import("./pdf-drawer");
const PdfDrawer = lazy(() =>
	importPdfDrawer().then((m) => ({ default: m.PdfDrawer }))
);

// Warm the drawer chunk ahead of the first click (e.g. as soon as a report card
// with a PDF renders), so tapping opens the drawer immediately instead of
// waiting on the chunk download. The bundler caches the module, so lazy()'s
// later import reuses it. Safe to call repeatedly and pre-mount.
let warmed = false;
export function warmPdfDrawer(): void {
	if (warmed || typeof window === "undefined") {
		return;
	}
	warmed = true;
	importPdfDrawer().catch(() => {
		// Prefetch is best-effort; a real open will retry and surface any error.
		warmed = false;
	});
}

export interface PdfVaultValue {
	/** Open a report/research PDF in the shared full-screen drawer. `pdfUrl` is
	 * the raw value from the tool result (a finance-mcp `/pdf?url=…` path). */
	open: (pdfUrl: string, title?: string) => void;
}

// Fallback used when a card renders outside a provider (e.g. a unit test, or a
// surface that hasn't mounted the vault): degrade to opening the proxied PDF in
// a new tab rather than throwing.
const FALLBACK_VAULT: PdfVaultValue = {
	open: (pdfUrl) => {
		const url = proxyPdfUrl(pdfUrl);
		if (url && typeof window !== "undefined") {
			window.open(url, "_blank", "noopener");
		}
	},
};

const PdfVaultContext = createContext<PdfVaultValue>(FALLBACK_VAULT);

export function usePdfVault(): PdfVaultValue {
	return useContext(PdfVaultContext);
}

interface VaultState {
	pdfUrl: string | null;
	title?: string;
}

/** Mounts one shared PDF drawer and exposes `open(pdfUrl, title)` to every
 * finance card underneath it — the "Vault". */
export function PdfVaultProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<VaultState>({ pdfUrl: null });
	// Stays true after the first open so vaul keeps its close animation, but is
	// false through SSR and until the first user interaction — which is what
	// keeps the lazy chunk (and pdfjs) off the server.
	const [hasOpened, setHasOpened] = useState(false);
	const open = useCallback((pdfUrl: string, title?: string) => {
		setHasOpened(true);
		setState({ pdfUrl, title });
	}, []);
	const value = useMemo<PdfVaultValue>(() => ({ open }), [open]);
	return (
		<PdfVaultContext.Provider value={value}>
			{children}
			{hasOpened ? (
				<Suspense fallback={null}>
					<PdfDrawer
						onOpenChange={(isOpen) => {
							if (!isOpen) {
								setState((prev) => ({ ...prev, pdfUrl: null }));
							}
						}}
						open={state.pdfUrl !== null}
						pdfUrl={state.pdfUrl}
						title={state.title}
					/>
				</Suspense>
			) : null}
		</PdfVaultContext.Provider>
	);
}
