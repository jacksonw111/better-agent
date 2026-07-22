import { expect, it } from "vitest";
import { fileExtension, resolvePreview } from "./registry";

const doc = (mime: string, name: string) => ({ mime, name });

it("extracts lowercase extensions and tolerates dotless names", () => {
	expect(fileExtension("Report.PDF")).toBe("pdf");
	expect(fileExtension("archive.tar.gz")).toBe("gz");
	expect(fileExtension("README")).toBe("");
});

it("resolves by extension even when the client-declared mime is generic", () => {
	expect(resolvePreview(doc("application/octet-stream", "data.csv"))?.id).toBe(
		"csv"
	);
	expect(resolvePreview(doc("application/octet-stream", "book.epub"))?.id).toBe(
		"epub"
	);
	expect(resolvePreview(doc("application/octet-stream", "q3.xlsx"))?.id).toBe(
		"xlsx"
	);
	expect(resolvePreview(doc("application/octet-stream", "cv.docx"))?.id).toBe(
		"docx"
	);
	expect(resolvePreview(doc("application/octet-stream", "main.rs"))?.id).toBe(
		"code"
	);
});

it("resolves by mime when the extension is missing", () => {
	expect(resolvePreview(doc("image/png", "pasted"))?.id).toBe("image");
	expect(resolvePreview(doc("text/plain", "notes"))?.id).toBe("code");
	expect(resolvePreview(doc("text/csv", "export"))?.id).toBe("csv");
});

it("prefers the CSV provider over the generic code provider for .csv", () => {
	expect(resolvePreview(doc("text/csv", "rows.csv"))?.id).toBe("csv");
});

it("returns null for formats we deliberately don't preview", () => {
	expect(resolvePreview(doc("application/octet-stream", "book.mobi"))).toBe(
		null
	);
	expect(resolvePreview(doc("application/msword", "old.doc"))).toBe(null);
	expect(resolvePreview(doc("application/zip", "bundle.zip"))).toBe(null);
});
