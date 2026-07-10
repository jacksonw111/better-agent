/**
 * Accessibility-only ("ax") computer-use handler. Drives a Cua VM through a
 * `ComputerServerClient`, translating high-level actions into computer-server
 * commands and returning plain-text results (no screenshots, no multimodal).
 *
 * `observe()` fetches the accessibility tree, flattens it into a numbered
 * outline of actionable elements, and caches each index's screen-center so
 * `clickElement(index)` can click without the model ever seeing coordinates.
 */

import type { ComputerServerClient } from "./computer-server-client";

/** A node in the computer-server accessibility tree. The macOS handler emits
 * `name`/`bbox`/`position`/`size` (positions/sizes are `"x;y"`/`"w;h"` strings,
 * `bbox` is `[x1,y1,x2,y2]`); windows/menubar/dock items carry a `bounds`
 * object. All fields are optional and tolerated defensively. */
export interface AxNode {
	absolute_position?: string;
	bbox?: unknown;
	bounds?: {
		height?: number;
		width?: number;
		x?: number;
		y?: number;
	};
	children?: AxNode[];
	description?: string;
	name?: string;
	position?: string;
	role?: string;
	size?: string;
	title?: string;
	value?: unknown;
}

export interface ActionableNode {
	center: { x: number; y: number };
	index: number;
	label: string;
	role: string;
}

export type ScrollDirection = "down" | "left" | "right" | "up";

export interface CuaHandler {
	clickElement: (index: number) => Promise<string>;
	observe: () => Promise<string>;
	pressKey: (combo: string) => Promise<string>;
	scroll: (direction: ScrollDirection, amount?: number) => Promise<string>;
	typeText: (text: string) => Promise<string>;
}

const DEFAULT_SCROLL_AMOUNT = 3;
/** Bound the outline so a huge desktop tree can't blow the tool-output cap. */
const MAX_ACTIONABLE_NODES = 500;
/** macOS accessibility roles are prefixed `AX` (e.g. `AXButton`). */
const AX_ROLE_PREFIX = /^AX/;

function asArray(value: unknown): AxNode[] {
	return Array.isArray(value) ? (value as AxNode[]) : [];
}

/** The full-desktop response nests actionable elements under `windows`
 * (each with `children`), plus flat `menubar_items`/`dock_items`. A bare node
 * or array of nodes is also accepted (simpler handlers / tests). */
function extractRoots(tree: unknown): AxNode[] {
	if (Array.isArray(tree)) {
		return tree as AxNode[];
	}
	if (!tree || typeof tree !== "object") {
		return [];
	}
	const obj = tree as Record<string, unknown>;
	const roots = [
		...asArray(obj.windows),
		...asArray(obj.menubar_items),
		...asArray(obj.dock_items),
	];
	return roots.length > 0 ? roots : [obj as AxNode];
}

function parsePair(value?: string): [number, number] | null {
	if (typeof value !== "string") {
		return null;
	}
	const parts = value.split(";");
	if (parts.length !== 2) {
		return null;
	}
	const a = Number(parts[0]);
	const b = Number(parts[1]);
	return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

function centerFromBounds(node: AxNode): { x: number; y: number } | null {
	const b = node.bounds;
	if (
		b &&
		typeof b.x === "number" &&
		typeof b.y === "number" &&
		typeof b.width === "number" &&
		typeof b.height === "number"
	) {
		return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	}
	return null;
}

function centerFromBbox(node: AxNode): { x: number; y: number } | null {
	const bbox = node.bbox;
	if (
		Array.isArray(bbox) &&
		bbox.length === 4 &&
		bbox.every((n) => typeof n === "number")
	) {
		const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = bbox as number[];
		return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
	}
	return null;
}

function centerFromPositionSize(node: AxNode): { x: number; y: number } | null {
	const pos = parsePair(node.absolute_position ?? node.position);
	const size = parsePair(node.size);
	if (!(pos && size)) {
		return null;
	}
	return { x: pos[0] + size[0] / 2, y: pos[1] + size[1] / 2 };
}

function resolveCenter(node: AxNode): { x: number; y: number } | null {
	return (
		centerFromBounds(node) ??
		centerFromBbox(node) ??
		centerFromPositionSize(node)
	);
}

function resolveLabel(node: AxNode): string {
	const named = node.title ?? node.name;
	if (typeof named === "string" && named.trim()) {
		return named.trim();
	}
	if (typeof node.value === "string" && node.value.trim()) {
		return node.value.trim();
	}
	if (typeof node.description === "string" && node.description.trim()) {
		return node.description.trim();
	}
	return "";
}

function normalizeRole(role?: string): string {
	if (typeof role !== "string" || !role || role === "No role") {
		return "element";
	}
	return role.replace(AX_ROLE_PREFIX, "").toLowerCase() || "element";
}

/** Depth-first flatten of the accessibility tree into an ordered list of
 * actionable elements. A node is actionable when it has both a human-readable
 * label (title/name/value/description) and resolvable screen bounds. Pure and
 * exported for direct testing. */
export function flattenAccessibilityTree(tree: unknown): ActionableNode[] {
	const out: ActionableNode[] = [];
	const stack = [...extractRoots(tree)].reverse();
	while (stack.length > 0 && out.length < MAX_ACTIONABLE_NODES) {
		const node = stack.pop();
		if (!node || typeof node !== "object") {
			continue;
		}
		const label = resolveLabel(node);
		const center = resolveCenter(node);
		if (label && center) {
			out.push({
				center,
				index: out.length,
				label,
				role: normalizeRole(node.role),
			});
		}
		if (Array.isArray(node.children)) {
			for (let i = node.children.length - 1; i >= 0; i--) {
				const child = node.children[i];
				if (child) {
					stack.push(child);
				}
			}
		}
	}
	return out;
}

function formatOutline(nodes: ActionableNode[]): string {
	if (nodes.length === 0) {
		return "No actionable elements found.";
	}
	return nodes.map((n) => `[${n.index}] ${n.role} "${n.label}"`).join("\n");
}

/** Horizontal scroll has no dedicated command; computer-server exposes only a
 * generic `scroll(x, y)` for left/right, while up/down use `scroll_up`/
 * `scroll_down { clicks }`. */
function scrollCommand(
	direction: ScrollDirection,
	amount: number
): { command: string; params: Record<string, unknown> } {
	if (direction === "up") {
		return { command: "scroll_up", params: { clicks: amount, x: 0, y: 0 } };
	}
	if (direction === "down") {
		return { command: "scroll_down", params: { clicks: amount, x: 0, y: 0 } };
	}
	const x = direction === "left" ? -amount : amount;
	return { command: "scroll", params: { x, y: 0 } };
}

export function createCuaHandler({
	client,
}: {
	client: ComputerServerClient;
}): CuaHandler {
	let cache: ActionableNode[] = [];

	const observe = async (): Promise<string> => {
		const tree = await client.send("get_accessibility_tree");
		cache = flattenAccessibilityTree(tree);
		return formatOutline(cache);
	};

	const clickElement = async (index: number): Promise<string> => {
		const node = cache[index];
		if (!node) {
			return `Error: no element with index ${index}. Call observe first.`;
		}
		await client.send("left_click", {
			x: Math.round(node.center.x),
			y: Math.round(node.center.y),
		});
		return `Clicked [${index}] ${node.role} "${node.label}"`;
	};

	const typeText = async (text: string): Promise<string> => {
		await client.send("type_text", { text });
		return `Typed ${text.length} character(s)`;
	};

	const pressKey = async (combo: string): Promise<string> => {
		if (combo.includes("+")) {
			const keys = combo
				.split("+")
				.map((k) => k.trim())
				.filter(Boolean);
			await client.send("hotkey", { keys });
			return `Pressed hotkey ${keys.join("+")}`;
		}
		await client.send("press_key", { key: combo });
		return `Pressed key ${combo}`;
	};

	const scroll = async (
		direction: ScrollDirection,
		amount = DEFAULT_SCROLL_AMOUNT
	): Promise<string> => {
		const { command, params } = scrollCommand(direction, amount);
		await client.send(command, params);
		return `Scrolled ${direction} by ${amount}`;
	};

	return { clickElement, observe, pressKey, scroll, typeText };
}
