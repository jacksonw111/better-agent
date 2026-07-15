import { expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./push-subscription";

// P3-T3: the base64url→bytes conversion feeding PushManager.subscribe's
// applicationServerKey. (The SW/registration flows are browser-only and
// deliberately kept too dumb to unit-test — see public/sw.js.)

it("decodes a base64url string with URL-safe characters", () => {
	// "??>" is 0xff 0xff 0x3e — encodes to "//8+" in base64, "__8-" in base64url.
	expect([...urlBase64ToUint8Array("__8-")]).toEqual([0xff, 0xff, 0x3e]);
});

it("restores stripped padding for non-multiple-of-4 lengths", () => {
	// "M" = 0x4d → base64 "TQ==" → base64url without padding "TQ".
	expect([...urlBase64ToUint8Array("TQ")]).toEqual([0x4d]);
	// "Ma" = 0x4d 0x61 → "TWE=" → "TWE".
	expect([...urlBase64ToUint8Array("TWE")]).toEqual([0x4d, 0x61]);
	expect([...urlBase64ToUint8Array("")]).toEqual([]);
});

it("round-trips a realistic 65-byte VAPID public key", () => {
	const bytes = new Uint8Array(65).map((_v, i) => (i * 7) % 256);
	const base64 = btoa(String.fromCharCode(...bytes));
	const base64Url = base64
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
	expect([...urlBase64ToUint8Array(base64Url)]).toEqual([...bytes]);
});
