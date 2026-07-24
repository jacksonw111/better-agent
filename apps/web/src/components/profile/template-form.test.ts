import { expect, it } from "vitest";
import type { ProjectTemplate } from "@/utils/api-types";
import {
	EMPTY_TEMPLATE_FORM,
	isTemplateFormValid,
	templateToForm,
	toTemplateInput,
} from "./template-form";

function makeTemplate(
	overrides: Partial<ProjectTemplate> = {}
): ProjectTemplate {
	return {
		id: "tpl-1",
		profileId: "profile-1",
		name: "Node service",
		description: "A REST service",
		scaffold: {
			dirs: ["src", "test"],
			files: [{ content: "node_modules", path: ".gitignore" }],
		},
		claudeMd: "Use pnpm.",
		mcpServerIds: ["mcp-1"],
		createdAt: new Date("2026-07-23T00:00:00Z"),
		updatedAt: new Date("2026-07-23T00:00:00Z"),
		...overrides,
	};
}

it("requires a name", () => {
	expect(isTemplateFormValid(EMPTY_TEMPLATE_FORM)).toBe(false);
	expect(isTemplateFormValid({ ...EMPTY_TEMPLATE_FORM, name: "x" })).toBe(true);
});

it("round-trips a template into a deeply-copied form", () => {
	const form = templateToForm(makeTemplate());
	expect(form.name).toBe("Node service");
	expect(form.dirs).toEqual(["src", "test"]);
	expect(form.files).toEqual([{ content: "node_modules", path: ".gitignore" }]);
	expect(form.mcpServerIds).toEqual(["mcp-1"]);
	// Copy, not alias — mutating the form must not touch the source row.
	form.dirs.push("extra");
	expect(makeTemplate().scaffold.dirs).toEqual(["src", "test"]);
});

it("drops blank rows and nulls empty optional fields", () => {
	const input = toTemplateInput({
		claudeMd: "  ",
		description: "",
		dirs: ["src", "  "],
		files: [
			{ content: "keep", path: "a.txt" },
			{ content: "drop", path: "  " },
		],
		mcpServerIds: [],
		name: "  Svc  ",
	});
	expect(input).toEqual({
		claudeMd: null,
		description: null,
		mcpServerIds: [],
		name: "Svc",
		scaffold: { dirs: ["src"], files: [{ content: "keep", path: "a.txt" }] },
	});
});
