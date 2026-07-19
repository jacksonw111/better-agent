import { expect, it, vi } from "vitest";
import { claudeCodeAdapter } from "./claude-code";
import { mockQuery, nextEvent } from "./claude-code-test-harness";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

// The composer's model/permission menus are CONTROLLED by the latest reported
// value (session_ready → the web's sessionReady detail). Before this fix the
// adapter applied setModel/setPermissionMode without ever re-reporting the
// applied value, so the web's menu snapped back to the startup value after
// every switch (and after a reload, since only the original session_ready is
// in history). These cover the read-back events that keep the display honest.

/** The SDK's full PermissionMode enum — every value must round-trip through
 * the adapter's validation AND produce a read-back event (枚举全值对照). Keep
 * in sync with PERMISSION_MODES in claude-code-startup-config.ts. */
const ALL_PERMISSION_MODES = [
	"default",
	"acceptEdits",
	"bypassPermissions",
	"plan",
	"dontAsk",
	"auto",
];

it("pushes a permission_mode_changed read-back event once the SDK applies the mode", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.setPermissionMode?.("plan");

	expect(harness.setPermissionMode).toHaveBeenCalledExactlyOnceWith("plan");
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "status",
		status: "permission_mode_changed",
		detail: { permissionMode: "plan" },
	});
});

it("emits a read-back event for every SDK permission mode value", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	for (const mode of ALL_PERMISSION_MODES) {
		handle.setPermissionMode?.(mode);
		expect(harness.setPermissionMode).toHaveBeenLastCalledWith(mode);
		expect(await nextEvent(iterator)).toMatchObject({
			kind: "status",
			status: "permission_mode_changed",
			detail: { permissionMode: mode },
		});
	}
});

it("pushes no read-back event for an unrecognized permission mode", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.setPermissionMode?.("not-a-real-mode");
	expect(harness.setPermissionMode).not.toHaveBeenCalled();

	// The stream stays silent: the next event is the user turn, not a read-back.
	handle.send("hi");
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "message",
		role: "user",
	});
});

it("pushes no read-back event when the SDK rejects the mode switch", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();
	harness.setPermissionMode.mockImplementation(() =>
		Promise.reject(new Error("nope"))
	);

	handle.setPermissionMode?.("plan");
	await Promise.resolve(); // let the rejection settle

	handle.send("hi");
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "message",
		role: "user",
	});
});

it("pushes a model_changed read-back event once the SDK applies the model", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.setModel?.("opus");

	expect(harness.setModel).toHaveBeenCalledExactlyOnceWith("opus");
	expect(await nextEvent(iterator)).toMatchObject({
		kind: "status",
		status: "model_changed",
		detail: { model: "opus" },
	});
});

it("resolves the init line's canonical model id to its reported alias in session_ready", async () => {
	// supportedModels() reports ALIAS rows ("sonnet", "opus", …) whose
	// resolvedModel is the canonical wire id; the init line reports the
	// canonical id. Without this mapping the composer's model menu can never
	// highlight (or display) the current model — its value isn't in the list.
	const { harness } = mockQuery([
		{ value: "sonnet", resolvedModel: "claude-sonnet-4-5" },
		{ value: "opus", resolvedModel: "claude-opus-4-6" },
	]);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	harness.yieldMessage({
		type: "system",
		subtype: "init",
		session_id: "sess-1",
		model: "claude-sonnet-4-5",
	});

	expect(await nextEvent(iterator)).toMatchObject({
		kind: "status",
		status: "session_ready",
		detail: { model: "sonnet", models: ["sonnet", "opus"] },
	});
});

it("keeps the init model id verbatim when no alias row resolves to it", async () => {
	const { harness } = mockQuery([
		{ value: "sonnet", resolvedModel: "claude-sonnet-4-5" },
	]);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	harness.yieldMessage({
		type: "system",
		subtype: "init",
		session_id: "sess-1",
		model: "claude-haiku-4-5",
	});

	expect(await nextEvent(iterator)).toMatchObject({
		kind: "status",
		status: "session_ready",
		detail: { model: "claude-haiku-4-5", models: ["sonnet"] },
	});
});
