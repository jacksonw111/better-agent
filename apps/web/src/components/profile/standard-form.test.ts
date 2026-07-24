import { expect, it } from "vitest";
import type { ProfileStandard } from "@/utils/api-types";
import {
	EMPTY_STANDARD_FORM,
	isStandardFormValid,
	standardToForm,
	toStandardInput,
} from "./standard-form";

function makeStandard(
	overrides: Partial<ProfileStandard> = {}
): ProfileStandard {
	return {
		id: "std-1",
		profileId: "profile-1",
		title: "Prefer const",
		body: "Use const by default.",
		enabled: false,
		sortOrder: 0,
		createdAt: new Date("2026-07-23T00:00:00Z"),
		updatedAt: new Date("2026-07-23T00:00:00Z"),
		...overrides,
	};
}

it("treats a blank title or body as invalid", () => {
	expect(isStandardFormValid(EMPTY_STANDARD_FORM)).toBe(false);
	expect(isStandardFormValid({ ...EMPTY_STANDARD_FORM, title: "x" })).toBe(
		false
	);
	expect(isStandardFormValid({ title: "  ", body: "  ", enabled: true })).toBe(
		false
	);
});

it("accepts a form with both fields filled", () => {
	expect(
		isStandardFormValid({ title: "Rule", body: "Body", enabled: true })
	).toBe(true);
});

it("round-trips a standard row into a form, keeping enabled", () => {
	expect(standardToForm(makeStandard({ enabled: false }))).toEqual({
		body: "Use const by default.",
		enabled: false,
		title: "Prefer const",
	});
});

it("trims fields when building the mutation input", () => {
	expect(
		toStandardInput({ title: "  Rule  ", body: "  Body  ", enabled: false })
	).toEqual({ body: "Body", enabled: false, title: "Rule" });
});
