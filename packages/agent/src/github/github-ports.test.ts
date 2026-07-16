import { expect, it } from "vitest";
import { parseRepositoryUrl } from "./github-ports";

it("parses owner/repo shorthand", () => {
	expect(parseRepositoryUrl("octo/hello")).toBe("octo/hello");
	expect(parseRepositoryUrl("  octo/hello  ")).toBe("octo/hello");
	expect(parseRepositoryUrl("octo/hello.js")).toBe("octo/hello.js");
});

it("parses github.com web URLs in their common shapes", () => {
	expect(parseRepositoryUrl("https://github.com/octo/hello")).toBe(
		"octo/hello"
	);
	expect(parseRepositoryUrl("http://github.com/octo/hello")).toBe("octo/hello");
	expect(parseRepositoryUrl("https://www.github.com/octo/hello")).toBe(
		"octo/hello"
	);
	expect(parseRepositoryUrl("github.com/octo/hello")).toBe("octo/hello");
	expect(parseRepositoryUrl("https://github.com/octo/hello.git")).toBe(
		"octo/hello"
	);
	expect(parseRepositoryUrl("https://github.com/octo/hello/")).toBe(
		"octo/hello"
	);
});

it("parses deep github.com URLs down to the repository", () => {
	expect(parseRepositoryUrl("https://github.com/octo/hello/issues/12")).toBe(
		"octo/hello"
	);
	expect(
		parseRepositoryUrl("https://github.com/octo/hello/tree/main/src")
	).toBe("octo/hello");
});

it("parses ssh remotes", () => {
	expect(parseRepositoryUrl("git@github.com:octo/hello.git")).toBe(
		"octo/hello"
	);
	expect(parseRepositoryUrl("git@github.com:octo/hello")).toBe("octo/hello");
});

it("rejects inputs that are not a GitHub repository", () => {
	expect(parseRepositoryUrl("")).toBeNull();
	expect(parseRepositoryUrl("   ")).toBeNull();
	expect(parseRepositoryUrl("octo")).toBeNull();
	expect(parseRepositoryUrl("octo/hello/extra")).toBeNull();
	expect(parseRepositoryUrl("https://gitlab.com/octo/hello")).toBeNull();
	expect(parseRepositoryUrl("https://github.com/octo")).toBeNull();
	expect(parseRepositoryUrl("octo /hello")).toBeNull();
	expect(parseRepositoryUrl("octo/he llo")).toBeNull();
	expect(parseRepositoryUrl("-octo-/hello")).toBe("-octo-/hello");
});
