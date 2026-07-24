import type { ProfileStandard } from "@/utils/api-types";

/** The editable fields of a standard. `enabled` is carried so the edit dialog
 * round-trips it, though the list's inline switch is the usual toggle path. */
export interface StandardFormState {
	body: string;
	enabled: boolean;
	title: string;
}

export const EMPTY_STANDARD_FORM: StandardFormState = {
	body: "",
	enabled: true,
	title: "",
};

export function standardToForm(standard: ProfileStandard): StandardFormState {
	return {
		body: standard.body,
		enabled: standard.enabled,
		title: standard.title,
	};
}

export function isStandardFormValid(form: StandardFormState): boolean {
	return form.title.trim().length > 0 && form.body.trim().length > 0;
}

/** Trims the free-text fields into the shape `profiles.standards.create` /
 * `update` accept. */
export function toStandardInput(form: StandardFormState) {
	return {
		body: form.body.trim(),
		enabled: form.enabled,
		title: form.title.trim(),
	};
}
