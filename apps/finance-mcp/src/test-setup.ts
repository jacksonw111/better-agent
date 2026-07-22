import { beforeEach } from "vitest";
import { clearMemoryCache } from "./core/cache";

// The Node in-process cache is module-global state that survives across
// buildApp() instances (that's the point in production). In tests it would leak
// a cached success into the next test that stubs a different fetch response, so
// reset it before every test for isolation. The Workers `caches.default` path
// is exercised only by cache.test.ts, which installs/uninstalls its own fake.
beforeEach(() => {
	clearMemoryCache();
});
