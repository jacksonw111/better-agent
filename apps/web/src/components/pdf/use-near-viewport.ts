import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Returns true when the observed element is within `rootMargin` of the scroll
 * root (defaults to the document viewport). Once visible it stays visible
 * (one-way latch) so mounted pages are not torn down on scroll-out — this is
 * what keeps a long PDF cheap: only pages near the viewport ever rasterize.
 */
export function useNearViewport(
	elementRef: RefObject<HTMLElement | null>,
	scrollRoot: RefObject<HTMLElement | null>,
	rootMargin = "800px 0px"
): boolean {
	const [near, setNear] = useState(false);
	const observerRef = useRef<IntersectionObserver | null>(null);

	useEffect(() => {
		const el = elementRef.current;
		if (near || !el) {
			return () => undefined;
		}

		observerRef.current?.disconnect();

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					setNear(true);
					observer.disconnect();
				}
			},
			{ root: scrollRoot.current, rootMargin }
		);
		observer.observe(el);
		observerRef.current = observer;

		return () => observer.disconnect();
	}, [near, elementRef, scrollRoot, rootMargin]);

	return near;
}
