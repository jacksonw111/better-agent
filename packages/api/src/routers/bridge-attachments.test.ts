import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, BOB, build } from "./bridge-test-helpers";

// P3-T2: image upload (user plane) + download (bridge-token plane) through
// the router against the in-memory stores (same rig as bridge.test.ts).

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function pngFile(name = "shot.png", extraBytes = 8): File {
	const data = new Uint8Array(PNG_HEADER.length + extraBytes);
	data.set(PNG_HEADER, 0);
	return new File([data], name, { type: "image/png" });
}

async function startOne() {
	const rig = build();
	const cli = rig.bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	return {
		...rig,
		cli,
		sessionId,
		alice: rig.userClientFor(ALICE),
		bob: rig.userClientFor(BOB),
	};
}

it("uploads a valid PNG against an owned bridge session and returns its metadata", async () => {
	const { alice, attachment, sessionId } = await startOne();

	const result = await alice.bridge.uploadBridgeAttachment({
		sessionId,
		file: pngFile(),
	});

	expect(result.mime).toBe("image/png");
	expect(result.name).toBe("shot.png");
	expect(result.size).toBe(PNG_HEADER.length + 8);
	const row = await attachment.getById(result.id);
	expect(row?.sessionId).toBe(sessionId);
});

it("rejects an upload against another user's session with NOT_FOUND", async () => {
	const { bob, sessionId } = await startOne();

	await expect(
		bob.bridge.uploadBridgeAttachment({ sessionId, file: pngFile() })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("rejects an oversized image with BAD_REQUEST", async () => {
	const { alice, sessionId } = await startOne();

	await expect(
		alice.bridge.uploadBridgeAttachment({
			sessionId,
			file: pngFile("big.png", MAX_UPLOAD_BYTES),
		})
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("rejects a non-image mime with BAD_REQUEST", async () => {
	const { alice, sessionId } = await startOne();
	const file = new File([new Uint8Array([1, 2, 3])], "notes.txt", {
		type: "text/plain",
	});

	await expect(
		alice.bridge.uploadBridgeAttachment({ sessionId, file })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("rejects a file whose bytes don't match its declared image type", async () => {
	const { alice, sessionId } = await startOne();
	const file = new File([new Uint8Array([1, 2, 3, 4])], "fake.png", {
		type: "image/png",
	});

	await expect(
		alice.bridge.uploadBridgeAttachment({ sessionId, file })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("maps a missing object-store bucket to SERVICE_UNAVAILABLE", async () => {
	const { alice, attachment, sessionId } = await startOne();
	attachment.available = false;

	await expect(
		alice.bridge.uploadBridgeAttachment({ sessionId, file: pngFile() })
	).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
});

it("returns the uploaded bytes to the session's own bridge token", async () => {
	const { alice, cli, sessionId } = await startOne();
	const uploaded = await alice.bridge.uploadBridgeAttachment({
		sessionId,
		file: pngFile(),
	});

	const file = await cli.bridge.getBridgeAttachment({
		attachmentId: uploaded.id,
	});

	expect(file.name).toBe("shot.png");
	expect(file.type).toBe("image/png");
	const bytes = new Uint8Array(await file.arrayBuffer());
	expect([...bytes.slice(0, PNG_HEADER.length)]).toEqual(PNG_HEADER);
});

it("rejects a download from a different bridge token with NOT_FOUND", async () => {
	const rig = await startOne();
	const uploaded = await rig.alice.bridge.uploadBridgeAttachment({
		sessionId: rig.sessionId,
		file: pngFile(),
	});
	const otherToken = rig.bridgeClientFor({
		tokenId: "tok-2",
		userId: ALICE.id,
	});
	const otherUser = rig.bridgeClientFor({ tokenId: "tok-1", userId: BOB.id });

	await expect(
		otherToken.bridge.getBridgeAttachment({ attachmentId: uploaded.id })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	await expect(
		otherUser.bridge.getBridgeAttachment({ attachmentId: uploaded.id })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("rejects a download for an unknown attachment id with NOT_FOUND", async () => {
	const { cli } = await startOne();

	await expect(
		cli.bridge.getBridgeAttachment({ attachmentId: crypto.randomUUID() })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});
