import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";

// Some components persist state in `sessionStorage`; clear it between tests
// so one test's leftovers can't bleed into the next. Guarded so the
// node-environment test files, which have no `sessionStorage`, are unaffected.
if (typeof sessionStorage !== "undefined") {
	beforeEach(() => {
		sessionStorage.clear();
	});
}

// Finance genui charts (bar-series, data-table, line-series, ...) load their
// recharts-backed view via `React.lazy` + `<Suspense>`; the chart assertions
// `findBy*`/`findAllByTestId` to await that dynamic-import chunk. Under a
// parallel full-suite run, CPU contention across worker processes can push
// chunk resolution past @testing-library/dom's default 1000ms
// `asyncUtilTimeout`, producing an intermittent (test-infra, not product)
// timeout that never reproduces file-by-file. Raise the ceiling so `findBy*`
// keeps polling long enough for the chunk to resolve under load.
configure({ asyncUtilTimeout: 5000 });

// jsdom ships neither ResizeObserver (recharts' ResponsiveContainer needs
// it) nor matchMedia (used for prefers-reduced-motion). Most finance test
// files already polyfill both inline; this centralizes the same shims so
// any file that omits them is still covered. Guarded with `??=` so the
// per-file copies remain harmless no-ops.
globalThis.ResizeObserver ??= class {
	disconnect() {
		return;
	}
	observe() {
		return;
	}
	unobserve() {
		return;
	}
};

if (typeof window !== "undefined") {
	window.matchMedia ??= (query: string) =>
		({
			addEventListener: () => undefined,
			addListener: () => undefined,
			dispatchEvent: () => false,
			matches: query.includes("reduce"),
			media: query,
			onchange: null,
			removeEventListener: () => undefined,
			removeListener: () => undefined,
		}) as unknown as MediaQueryList;
}
