import { expect, it } from "vitest";
import { parseAgentKind } from "./agent-labels";

// parseAgentKind narrows a raw path param (/computers/$id/agents/$agentKind)
// to a real runtime kind, or null for a link that names an unknown one.
it("narrows path params to real agent kinds", () => {
	expect(parseAgentKind("claude-code")).toBe("claude-code");
	expect(parseAgentKind("pi")).toBe("pi");
	expect(parseAgentKind("not-an-agent")).toBeNull();
});
