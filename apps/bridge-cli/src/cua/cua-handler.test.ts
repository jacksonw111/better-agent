import { describe, expect, it, vi } from "vitest";
import type { ComputerServerClient } from "./computer-server-client";
import {
	type AxNode,
	createCuaHandler,
	flattenAccessibilityTree,
} from "./cua-handler";

/** A fake client that returns a queued reply for `get_accessibility_tree` and
 * records every `send` call for assertions. */
function makeFakeClient(
	treeReply: Record<string, unknown> = { success: true }
) {
	const send = vi.fn((command: string) =>
		Promise.resolve(
			command === "get_accessibility_tree" ? treeReply : { success: true }
		)
	);
	const client: ComputerServerClient = {
		close: vi.fn(),
		connect: vi.fn(() => Promise.resolve(undefined)),
		send: send as unknown as ComputerServerClient["send"],
	};
	return { client, send };
}

/** Desktop response mirroring the macOS computer-server shape: actionable
 * elements live under `windows[].children`, with `bbox` [x1,y1,x2,y2]. */
const DESKTOP_TREE = {
	success: true,
	windows: [
		{
			bounds: { height: 600, width: 800, x: 0, y: 0 },
			children: [
				{ bbox: [10, 20, 110, 60], name: "Save", role: "AXButton" },
				{ bbox: [10, 100, 210, 140], role: "AXTextField", value: "query" },
				{
					children: [
						{ bbox: [0, 0, 40, 20], name: "Bare", role: "AXStaticText" },
					],
					role: "AXGroup",
				},
			],
			name: "Editor",
			role: "AXWindow",
		},
	],
} satisfies Record<string, unknown>;

describe("flattenAccessibilityTree", () => {
	it("flattens a simple bounds-based tree depth-first and computes centers", () => {
		const tree: AxNode = {
			children: [
				{
					bounds: { height: 40, width: 100, x: 10, y: 20 },
					role: "button",
					title: "Save",
				},
				{
					bounds: { height: 40, width: 200, x: 10, y: 100 },
					role: "textfield",
					value: "Search",
				},
			],
			role: "group",
		};

		const nodes = flattenAccessibilityTree(tree);
		expect(nodes).toEqual([
			{ center: { x: 60, y: 40 }, index: 0, label: "Save", role: "button" },
			{
				center: { x: 110, y: 120 },
				index: 1,
				label: "Search",
				role: "textfield",
			},
		]);
	});

	it("handles the real macOS windows/bbox shape and strips the AX prefix", () => {
		const nodes = flattenAccessibilityTree(DESKTOP_TREE);
		expect(nodes.map((n) => `${n.role} "${n.label}"`)).toEqual([
			'window "Editor"',
			'button "Save"',
			'textfield "query"',
			'statictext "Bare"',
		]);
		// bbox [10,20,110,60] center = (60, 40)
		expect(nodes[1]?.center).toEqual({ x: 60, y: 40 });
	});

	it("skips nodes with no label or no resolvable bounds", () => {
		const tree = {
			children: [
				{ role: "AXButton" }, // no label, no bounds -> skipped
				{ name: "NoBounds", role: "AXButton" }, // label but no bounds -> skipped
				{ bbox: [0, 0, 10, 10], name: "Ok", role: "AXButton" },
			],
		};
		expect(flattenAccessibilityTree(tree).map((n) => n.label)).toEqual(["Ok"]);
	});
});

describe("createCuaHandler", () => {
	it("observe() returns a numbered outline and caches bounds for clicks", async () => {
		const { client, send } = makeFakeClient(DESKTOP_TREE);
		const handler = createCuaHandler({ client });

		const outline = await handler.observe();
		expect(send).toHaveBeenCalledWith("get_accessibility_tree");
		expect(outline).toBe(
			'[0] window "Editor"\n[1] button "Save"\n[2] textfield "query"\n[3] statictext "Bare"'
		);
	});

	it("clickElement(index) clicks the cached node's center", async () => {
		const { client, send } = makeFakeClient(DESKTOP_TREE);
		const handler = createCuaHandler({ client });
		await handler.observe();

		const result = await handler.clickElement(1);
		expect(send).toHaveBeenLastCalledWith("left_click", { x: 60, y: 40 });
		expect(result).toBe('Clicked [1] button "Save"');
	});

	it("clickElement returns an error string for an unknown index", async () => {
		const { client, send } = makeFakeClient(DESKTOP_TREE);
		const handler = createCuaHandler({ client });
		await handler.observe();

		const result = await handler.clickElement(99);
		expect(result).toContain("no element with index 99");
		expect(send).not.toHaveBeenCalledWith("left_click", expect.anything());
	});
});

describe("createCuaHandler - input actions", () => {
	it("typeText sends type_text", async () => {
		const { client, send } = makeFakeClient();
		const handler = createCuaHandler({ client });
		await handler.typeText("hello");
		expect(send).toHaveBeenCalledWith("type_text", { text: "hello" });
	});

	it("pressKey sends press_key for a single key and hotkey for a combo", async () => {
		const { client, send } = makeFakeClient();
		const handler = createCuaHandler({ client });

		await handler.pressKey("enter");
		expect(send).toHaveBeenCalledWith("press_key", { key: "enter" });

		await handler.pressKey("cmd+shift+p");
		expect(send).toHaveBeenCalledWith("hotkey", {
			keys: ["cmd", "shift", "p"],
		});
	});

	it("scroll maps up/down to scroll_up/scroll_down and left/right to scroll", async () => {
		const { client, send } = makeFakeClient();
		const handler = createCuaHandler({ client });

		await handler.scroll("down");
		expect(send).toHaveBeenCalledWith("scroll_down", { clicks: 3, x: 0, y: 0 });

		await handler.scroll("up", 5);
		expect(send).toHaveBeenCalledWith("scroll_up", { clicks: 5, x: 0, y: 0 });

		await handler.scroll("left", 2);
		expect(send).toHaveBeenCalledWith("scroll", { x: -2, y: 0 });
	});
});
