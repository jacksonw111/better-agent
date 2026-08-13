import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createJwtService } from "@better-agent/agent/crypto/jwt";
import { createFakeAgentStore } from "@better-agent/agent/testing/fake-agent-store";
import { createFakeUserStore } from "@better-agent/agent/testing/fake-auth-stores";
import { expect, it } from "vitest";
import { createContext } from "./context";
import type { AgentServices } from "./services";

function fakeHono(authHeader?: string, accessToken?: string) {
	return {
		req: {
			header: (name: string) =>
				name.toLowerCase() === "authorization" ? authHeader : undefined,
			query: (name: string) =>
				name === "access_token" ? accessToken : undefined,
		},
	} as never;
}

async function setup() {
	const tokenService = createTokenService();
	const agentStore = createFakeAgentStore();
	const { token } = tokenService.generate();
	const created = await agentStore.create({
		name: "A",
		description: "d",
		systemPrompt: "s",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		tokenHash: tokenService.hash(token),
	});
	const services = {
		tokenService,
		stores: {
			activity: { log: () => Promise.resolve() },
			agent: agentStore,
		},
	} as unknown as AgentServices;
	return { services, token, agentId: created.id };
}

it("resolves authedAgent from a valid Bearer token", async () => {
	const { services, token, agentId } = await setup();
	const ctx = await createContext({
		context: fakeHono(`Bearer ${token}`),
		services,
	});
	expect(ctx.authedAgent?.id).toBe(agentId);
});

it("authedAgent is null with no header", async () => {
	const { services } = await setup();
	const ctx = await createContext({ context: fakeHono(undefined), services });
	expect(ctx.authedAgent).toBeNull();
});

it("falls back to the ?access_token= query when there's no header", async () => {
	const { services, token, agentId } = await setup();
	const ctx = await createContext({
		context: fakeHono(undefined, token),
		services,
	});
	expect(ctx.authedAgent?.id).toBe(agentId);
});

it("authedAgent is null for an unknown token", async () => {
	const { services } = await setup();
	const ctx = await createContext({
		context: fakeHono("Bearer ba_nope"),
		services,
	});
	expect(ctx.authedAgent).toBeNull();
});

it("resolves authedUser from a valid access JWT", async () => {
	const jwtService = createJwtService("a-test-secret-at-least-32-chars-long!!");
	const userStore = createFakeUserStore();
	const user = await userStore.findOrCreate("x@y.com");
	const token = await jwtService.sign({ sub: user.id, email: user.email }, 900);
	const services = {
		jwtService,
		stores: { user: userStore },
	} as unknown as AgentServices;
	const ctx = await createContext({
		context: fakeHono(`Bearer ${token}`),
		services,
	});
	expect(ctx.authedUser?.id).toBe(user.id);
});

it("authedUser is null for a non-JWT bearer token", async () => {
	const services = {
		jwtService: createJwtService("a-test-secret-at-least-32-chars-long!!"),
		stores: { user: createFakeUserStore() },
	} as unknown as AgentServices;
	const ctx = await createContext({
		context: fakeHono("Bearer ba_not_a_jwt"),
		services,
	});
	expect(ctx.authedUser).toBeNull();
});
