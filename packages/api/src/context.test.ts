import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
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

it("resolves authedBridgeToken from a valid bt_ token", async () => {
	const token = generateToken("bt_");
	const services = {
		stores: {
			bridgeToken: {
				findByHash: (hash: string) =>
					Promise.resolve(
						hash === hashToken(token)
							? { id: "tok-1", userId: "user-1", revokedAt: null }
							: null
					),
			},
		},
	} as unknown as AgentServices;
	const ctx = await createContext({
		context: fakeHono(`Bearer ${token}`),
		services,
	});
	expect(ctx.authedBridgeToken).toEqual({ tokenId: "tok-1", userId: "user-1" });
});

it("authedBridgeToken is null for a revoked token", async () => {
	const token = generateToken("bt_");
	const services = {
		stores: {
			bridgeToken: {
				findByHash: () =>
					Promise.resolve({
						id: "tok-1",
						userId: "user-1",
						revokedAt: new Date(),
					}),
			},
		},
	} as unknown as AgentServices;
	const ctx = await createContext({
		context: fakeHono(`Bearer ${token}`),
		services,
	});
	expect(ctx.authedBridgeToken).toBeNull();
});

// S1-T2: raw x-ba-* computer-auth headers are extracted into context; the
// signature itself is only verified later by computerProcedure.

function fakeHonoWithHeaders(headers: Record<string, string>) {
	return {
		req: {
			header: (name: string) => headers[name.toLowerCase()],
			query: () => undefined,
		},
	} as never;
}

const COMPUTER_TIMESTAMP_MS = 1_752_600_000_000;

const COMPUTER_HEADERS = {
	"x-ba-computer-id": "computer-1",
	"x-ba-timestamp": String(COMPUTER_TIMESTAMP_MS),
	"x-ba-signature": "c2ln",
};

it("extracts computerAuth from the x-ba-* headers", async () => {
	const ctx = await createContext({
		context: fakeHonoWithHeaders(COMPUTER_HEADERS),
		services: {} as unknown as AgentServices,
	});
	expect(ctx.computerAuth).toEqual({
		computerId: "computer-1",
		signature: "c2ln",
		timestampMs: COMPUTER_TIMESTAMP_MS,
	});
});

it("computerAuth is null when a header is missing or the timestamp is not an integer", async () => {
	const services = {} as unknown as AgentServices;
	const missing = await createContext({
		context: fakeHonoWithHeaders({
			"x-ba-computer-id": "computer-1",
			"x-ba-timestamp": String(COMPUTER_TIMESTAMP_MS),
		}),
		services,
	});
	expect(missing.computerAuth).toBeNull();
	const garbled = await createContext({
		context: fakeHonoWithHeaders({
			...COMPUTER_HEADERS,
			"x-ba-timestamp": "not-a-number",
		}),
		services,
	});
	expect(garbled.computerAuth).toBeNull();
});

it("authedBridgeToken is null for an unknown bt_ token", async () => {
	const services = {
		stores: { bridgeToken: { findByHash: () => Promise.resolve(null) } },
	} as unknown as AgentServices;
	const ctx = await createContext({
		context: fakeHono("Bearer bt_nope"),
		services,
	});
	expect(ctx.authedBridgeToken).toBeNull();
});
