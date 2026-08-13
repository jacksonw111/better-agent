import type {
	AgentMemoryRow,
	EmbeddingClient,
	MemoryItemRow,
	MemoryItemStore,
	MemoryRow,
	MemoryStore,
} from "../ports";

// Minimal fakes for the B1 memory-retrieval injection tests (turn-messages,
// memory-retrieval). Only the members the retrieval path touches are backed
// by real state; everything else throws NOT_IMPLEMENTED so an accidental call
// fails loudly instead of silently no-op'ing.
function notImplemented(): never {
	throw new Error("not implemented in fake");
}

// An arbitrary fixed vector — the retrieval path never inspects its values,
// only that embed() resolves to *something* of the right shape.
const FAKE_VECTOR_DIM_1 = 0.1;
const FAKE_VECTOR_DIM_2 = 0.2;
const FAKE_VECTOR_DIM_3 = 0.3;
const FAKE_EMBEDDING_VECTOR = [
	FAKE_VECTOR_DIM_1,
	FAKE_VECTOR_DIM_2,
	FAKE_VECTOR_DIM_3,
];

/** Seeds `listAgentMemories(agentId)` with a fixed link list; every other
 * MemoryStore member is unused by the retrieval path. */
export function createFakeMemoryStore(
	linksByAgent: Record<string, AgentMemoryRow[]> = {}
): MemoryStore {
	return {
		listAgentMemories(agentId) {
			return Promise.resolve(linksByAgent[agentId] ?? []);
		},
		assignAgent: notImplemented,
		unassignAgent: notImplemented,
		create: notImplemented,
		delete: notImplemented,
		deleteWithChildren: notImplemented,
		get: notImplemented,
		getMany: notImplemented,
		listByUser: notImplemented,
	};
}

/** `search()` returns whatever `items` (or the search override) is seeded with
 * — a real kNN isn't needed since the fake embedding client below always
 * returns a fixed vector. */
export function createFakeMemoryItemStore(
	items: MemoryItemRow[] = []
): MemoryItemStore {
	return {
		search: () => Promise.resolve(items),
		add: notImplemented,
		get: notImplemented,
		listCurrent: notImplemented,
		softDelete: notImplemented,
	};
}

export function fakeMemoryItem(
	overrides: Partial<MemoryItemRow> = {}
): MemoryItemRow {
	const now = new Date();
	return {
		id: crypto.randomUUID(),
		memoryId: "mem-1",
		content: "fake memory content",
		importance: 0.5,
		source: "user",
		metadata: null,
		lastAccessedAt: null,
		validFrom: now,
		validTo: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

/** Always returns a fixed vector; pass `fails: true` to simulate an
 * unconfigured/broken embedding provider (embed() rejects). */
export function createFakeEmbeddingClient(
	options: { fails?: boolean } = {}
): EmbeddingClient {
	return {
		model: "fake-model",
		embed(_text) {
			if (options.fails) {
				return Promise.reject(new Error("embedding provider unavailable"));
			}
			return Promise.resolve(FAKE_EMBEDDING_VECTOR);
		},
	};
}

export function fakeMemoryRow(overrides: Partial<MemoryRow> = {}): MemoryRow {
	const now = new Date();
	return {
		id: crypto.randomUUID(),
		userId: "user-1",
		name: "fake memory",
		description: null,
		scope: "global",
		projectId: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}
