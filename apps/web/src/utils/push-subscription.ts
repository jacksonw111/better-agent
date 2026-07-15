import { client } from "@/utils/orpc";

// P3-T3 (docs/local-agent-workspace-plan.md §P3-3): browser-side Web Push
// wiring — service-worker registration, PushManager subscribe/unsubscribe,
// and the server round-trips. The service worker itself is the plain-JS
// `public/sw.js` (no bundling); the VAPID public key comes from the
// `pushSubscriptions.vapidPublicKey` route (server-owned, so a key rotation
// never requires a web rebuild).

const SW_URL = "/sw.js";

const BASE64_BLOCK = 4;
const BASE64URL_DASH = /-/g;
const BASE64URL_UNDERSCORE = /_/g;

/** Decodes a base64url VAPID public key into the raw bytes
 * `PushManager.subscribe` wants for `applicationServerKey`. */
export function urlBase64ToUint8Array(
	base64Url: string
): Uint8Array<ArrayBuffer> {
	const padding = "=".repeat(
		(BASE64_BLOCK - (base64Url.length % BASE64_BLOCK)) % BASE64_BLOCK
	);
	const base64 = (base64Url + padding)
		.replace(BASE64URL_DASH, "+")
		.replace(BASE64URL_UNDERSCORE, "/");
	const raw = atob(base64);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) {
		bytes[i] = raw.charCodeAt(i);
	}
	return bytes;
}

/** SSR-safe capability check: Web Push needs a secure context (HTTPS or
 * localhost) plus service-worker, Push API and Notification support — the
 * quick-settings row hides itself entirely when this is false. */
export function isPushSupported(): boolean {
	return (
		typeof window !== "undefined" &&
		window.isSecureContext &&
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

/** This browser's current push subscription, if the SW is registered and
 * subscribed. Callers must gate on `isPushSupported()` first. */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
	const registration = await navigator.serviceWorker.getRegistration(SW_URL);
	if (!registration) {
		return null;
	}
	return await registration.pushManager.getSubscription();
}

export type EnablePushResult = "enabled" | "permission-denied";

/** Registers the SW, asks for notification permission, subscribes with the
 * server's VAPID key and registers the subscription server-side. Returns
 * "permission-denied" (for the caller to toast) instead of throwing when the
 * user blocks notifications; any other failure throws. */
export async function enablePush(
	vapidPublicKey: string
): Promise<EnablePushResult> {
	const registration = await navigator.serviceWorker.register(SW_URL);
	const permission = await Notification.requestPermission();
	if (permission !== "granted") {
		return "permission-denied";
	}
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
	});
	const keys = subscription.toJSON().keys;
	if (!(keys?.p256dh && keys?.auth)) {
		await subscription.unsubscribe();
		throw new Error("浏览器返回的推送订阅缺少密钥");
	}
	await client.pushSubscriptions.subscribe({
		endpoint: subscription.endpoint,
		keys: { p256dh: keys.p256dh, auth: keys.auth },
	});
	return "enabled";
}

/** Unsubscribes both sides — the server row first (while we still know the
 * endpoint), then the browser subscription itself. */
export async function disablePush(): Promise<void> {
	const subscription = await getCurrentPushSubscription();
	if (!subscription) {
		return;
	}
	await client.pushSubscriptions.unsubscribe({
		endpoint: subscription.endpoint,
	});
	await subscription.unsubscribe();
}
