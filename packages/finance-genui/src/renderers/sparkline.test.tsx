// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { DOWN_COLOR, UP_COLOR } from "./format";
import { Sparkline } from "./sparkline";

const WHITESPACE_RE = /\s+/;

it("renders nothing for an empty series", () => {
	const { container } = render(<Sparkline values={[]} />);
	expect(container.querySelector("svg")).toBeNull();
});

it("renders a single centered dot for a one-value series instead of a polyline", () => {
	const { container } = render(<Sparkline values={[42]} />);
	expect(container.querySelector("polyline")).toBeNull();
	expect(container.querySelector("circle")).not.toBeNull();
});

it("tone='up' always uses the price axis's up color", () => {
	const { container } = render(<Sparkline tone="up" values={[5, 1, 3]} />);
	const line = container.querySelector("polyline") as SVGPolylineElement;
	expect(line.getAttribute("stroke")).toBe(UP_COLOR);
});

it("tone='down' always uses the price axis's down color", () => {
	const { container } = render(<Sparkline tone="down" values={[1, 5, 3]} />);
	const line = container.querySelector("polyline") as SVGPolylineElement;
	expect(line.getAttribute("stroke")).toBe(DOWN_COLOR);
});

it("tone='auto' colors up when the series rises from first to last", () => {
	const { container } = render(<Sparkline tone="auto" values={[1, 2, 5]} />);
	const line = container.querySelector("polyline") as SVGPolylineElement;
	expect(line.getAttribute("stroke")).toBe(UP_COLOR);
});

it("tone='auto' colors down when the series falls from first to last", () => {
	const { container } = render(<Sparkline tone="auto" values={[5, 2, 1]} />);
	const line = container.querySelector("polyline") as SVGPolylineElement;
	expect(line.getAttribute("stroke")).toBe(DOWN_COLOR);
});

it("tone='neutral' uses currentColor instead of a price-axis hex", () => {
	const { container } = render(<Sparkline tone="neutral" values={[1, 5, 2]} />);
	const line = container.querySelector("polyline") as SVGPolylineElement;
	expect(line.getAttribute("stroke")).toBe("currentColor");
});

it("a flat series under tone='auto' falls back to currentColor rather than guessing a direction", () => {
	const { container } = render(<Sparkline tone="auto" values={[3, 3, 3]} />);
	const line = container.querySelector("polyline") as SVGPolylineElement;
	expect(line.getAttribute("stroke")).toBe("currentColor");
});

it("emits one polyline point per value", () => {
	const { container } = render(<Sparkline tone="up" values={[1, 2, 3, 4]} />);
	const line = container.querySelector("polyline") as SVGPolylineElement;
	const points = line.getAttribute("points")?.trim().split(WHITESPACE_RE);
	expect(points).toHaveLength(4);
});
