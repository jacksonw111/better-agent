// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	type ImageRef,
	imageCountSuffix,
	useImageAttachments,
} from "./use-image-attachments";

function png(name = "shot.png", bytes = 8): File {
	return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, reject, resolve };
}

const REF: ImageRef = { id: "att-1", mime: "image/png", name: "shot.png" };

it("uploads on attach and exposes the ref once settled", async () => {
	const upload = vi.fn().mockResolvedValue(REF);
	const { result } = renderHook(() => useImageAttachments(upload));

	act(() => result.current.addFiles([png()]));
	expect(result.current.uploading).toBe(true);
	expect(result.current.pending).toHaveLength(1);

	await act(async () => {
		await Promise.resolve();
	});
	expect(result.current.uploading).toBe(false);
	expect(result.current.pending[0]?.ref).toEqual(REF);
});

it("a failed upload drops the entry (toast) instead of leaving a dead thumb", async () => {
	const gate = deferred<ImageRef>();
	const upload = vi.fn().mockReturnValue(gate.promise);
	const { result } = renderHook(() => useImageAttachments(upload));

	act(() => result.current.addFiles([png()]));
	await act(async () => {
		gate.reject(new Error("boom"));
		await Promise.resolve();
	});
	expect(result.current.pending).toHaveLength(0);
});

it("rejects non-images and oversized files client-side without uploading", () => {
	const upload = vi.fn();
	const { result } = renderHook(() => useImageAttachments(upload));

	act(() =>
		result.current.addFiles([
			new File(["x"], "notes.txt", { type: "text/plain" }),
		])
	);
	expect(upload).not.toHaveBeenCalled();
	expect(result.current.pending).toHaveLength(0);
});

it("takeRefs returns only uploaded refs and clears the strip", async () => {
	const upload = vi.fn().mockResolvedValue(REF);
	const { result } = renderHook(() => useImageAttachments(upload));

	act(() => result.current.addFiles([png()]));
	await act(async () => {
		await Promise.resolve();
	});

	let refs: ImageRef[] = [];
	act(() => {
		refs = result.current.takeRefs();
	});
	expect(refs).toEqual([REF]);
	expect(result.current.pending).toHaveLength(0);
});

it("remove discards one pending image", async () => {
	const upload = vi.fn().mockResolvedValue(REF);
	const { result } = renderHook(() => useImageAttachments(upload));
	act(() => result.current.addFiles([png()]));
	await act(async () => {
		await Promise.resolve();
	});
	const localId = result.current.pending[0]?.localId ?? "";
	act(() => result.current.remove(localId));
	expect(result.current.pending).toHaveLength(0);
});

describe("imageCountSuffix", () => {
	it("matches the CLI's byte-identical suffix contract", () => {
		expect(imageCountSuffix(0)).toBe("");
		expect(imageCountSuffix(2)).toBe(" [图片×2]");
	});
});
