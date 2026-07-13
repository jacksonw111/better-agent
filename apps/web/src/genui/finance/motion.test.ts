import { expect, it } from "vitest";
import {
	entranceVariants,
	rowItemVariants,
	staggerContainerVariants,
} from "./motion";

it("entranceVariants keeps opacity+translateY when motion is allowed", () => {
	const variants = entranceVariants(false);
	expect(variants.hidden).toMatchObject({ opacity: 0, y: expect.any(Number) });
	expect(variants.visible).toMatchObject({ opacity: 1, y: 0 });
});

it("entranceVariants drops the transform when reduced motion is requested", () => {
	const variants = entranceVariants(true);
	expect(variants.hidden).toEqual({ opacity: 0 });
	expect(variants.hidden).not.toHaveProperty("y");
	expect(variants.visible).not.toHaveProperty("y");
});

it("staggerContainerVariants staggers children when motion is allowed", () => {
	const variants = staggerContainerVariants(false);
	const visible = variants.visible as {
		transition?: { staggerChildren?: number };
	};
	expect(visible.transition?.staggerChildren).toBeGreaterThan(0);
});

it("staggerContainerVariants disables stagger when reduced motion is requested", () => {
	const variants = staggerContainerVariants(true);
	const visible = variants.visible as {
		transition?: { staggerChildren?: number };
	};
	expect(visible.transition?.staggerChildren).toBe(0);
});

it("rowItemVariants keeps opacity+translateY when motion is allowed", () => {
	const variants = rowItemVariants(false);
	expect(variants.hidden).toMatchObject({ opacity: 0, y: expect.any(Number) });
	expect(variants.visible).toMatchObject({ opacity: 1, y: 0 });
});

it("rowItemVariants drops the transform when reduced motion is requested", () => {
	const variants = rowItemVariants(true);
	expect(variants.hidden).toEqual({ opacity: 0 });
	expect(variants.visible).toEqual({ opacity: 1 });
	expect(variants.hidden).not.toHaveProperty("y");
	expect(variants.visible).not.toHaveProperty("y");
});
