// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ScaffoldEditor } from "./scaffold-editor";
import type { ScaffoldFile } from "./template-form";

function renderEditor(files: ScaffoldFile[] = [], dirs: string[] = []) {
	const onFilesChange = vi.fn();
	const onDirsChange = vi.fn();
	const { container } = render(
		<ScaffoldEditor
			dirs={dirs}
			files={files}
			onDirsChange={onDirsChange}
			onFilesChange={onFilesChange}
		/>
	);
	return { onDirsChange, onFilesChange, view: within(container) };
}

afterEach(() => {
	cleanup();
});

it("adds a blank file row", () => {
	const { onFilesChange, view } = renderEditor();
	fireEvent.click(view.getByRole("button", { name: "Add file" }));
	expect(onFilesChange).toHaveBeenCalledWith([{ content: "", path: "" }]);
});

it("edits an existing file's path", () => {
	const { onFilesChange, view } = renderEditor([{ content: "", path: "" }]);
	fireEvent.change(view.getByLabelText("File 1 path"), {
		target: { value: "README.md" },
	});
	expect(onFilesChange).toHaveBeenCalledWith([
		{ content: "", path: "README.md" },
	]);
});

it("removes a file row", () => {
	const { onFilesChange, view } = renderEditor([
		{ content: "a", path: "a.txt" },
	]);
	fireEvent.click(view.getByRole("button", { name: "Remove file 1" }));
	expect(onFilesChange).toHaveBeenCalledWith([]);
});

it("adds and removes directory rows", () => {
	const { onDirsChange, view } = renderEditor([], ["src"]);
	fireEvent.click(view.getByRole("button", { name: "Add directory" }));
	expect(onDirsChange).toHaveBeenCalledWith(["src", ""]);
	fireEvent.click(view.getByRole("button", { name: "Remove directory 1" }));
	expect(onDirsChange).toHaveBeenCalledWith([]);
});
