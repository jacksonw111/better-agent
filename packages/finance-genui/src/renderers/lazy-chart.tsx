import { type ComponentType, lazy, type ReactNode, Suspense } from "react";

// recharts (~60KB gzip) is imported by ~10 finance chart cards. Those cards are
// registered in finance-renderers.tsx, which the chat bundle pulls in eagerly —
// so without this, recharts ships to every chat session up front. Wrapping each
// chart in a lazy boundary moves recharts into an on-demand chunk that only
// downloads when a finance chart actually renders. Charts are below-the-fold
// genui, so a brief skeleton while the chunk streams in is fine.
const FALLBACK: ReactNode = (
	<div className="h-48 w-full animate-pulse rounded-lg bg-muted/40" />
);

type LooseComponent = ComponentType<Record<string, unknown>>;

// `C` captures the chart's exact component type so call sites stay fully typed;
// internally we go through a loose component type to sidestep React.lazy's prop
// variance, then re-cast the Suspense wrapper back to `C`.
export function lazyChart<C extends ComponentType<never>>(
	loader: () => Promise<{ default: C }>
): C {
	const Lazy = lazy(
		loader as unknown as () => Promise<{ default: LooseComponent }>
	);
	const Wrapped = (props: Record<string, unknown>): ReactNode => (
		<Suspense fallback={FALLBACK}>
			<Lazy {...props} />
		</Suspense>
	);
	return Wrapped as unknown as C;
}
