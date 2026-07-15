// P3-T3 (docs/local-agent-workspace-plan.md §P3-3): Web Push service worker.
// Plain unbundled JS served from /sw.js (vite copies public/ to the site
// root). Deliberately dumb: the payload shape is owned by the server
// (packages/agent/src/push-ports.ts `PushPayload`) and all decision logic
// lives server-side — this file only shows/clicks notifications.

/** True when some tab of the app is focused and visible — the user is
 * already looking at the app, so an OS notification would just be noise. */
async function hasFocusedClient() {
	const clientList = await self.clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	});
	return clientList.some(
		(client) => client.focused && client.visibilityState === "visible"
	);
}

async function showPush(payload) {
	if (await hasFocusedClient()) {
		return;
	}
	await self.registration.showNotification(payload.title ?? "Better Agent", {
		body: payload.body ?? "",
		// Same-tag pushes (one session+moment) replace instead of stacking.
		tag: payload.tag,
		data: { url: payload.url },
	});
}

self.addEventListener("push", (event) => {
	if (!event.data) {
		return;
	}
	let payload;
	try {
		payload = event.data.json();
	} catch {
		return;
	}
	event.waitUntil(showPush(payload));
});

/** Focus an existing app tab and deep-link it, else open a fresh one. */
async function openDeepLink(url) {
	const clientList = await self.clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	});
	const existing = clientList.find((client) => "focus" in client);
	if (existing) {
		await existing.focus();
		if ("navigate" in existing) {
			await existing.navigate(url);
		}
		return;
	}
	await self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = event.notification.data?.url ?? "/";
	event.waitUntil(openDeepLink(url));
});
