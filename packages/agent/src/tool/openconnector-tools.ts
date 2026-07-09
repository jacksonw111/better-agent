import type { ExecuteResult, JsonSchema, ToolDef } from "./types";

export interface OpenConnectorProviderMeta {
	authTypes: string[];
	categories: string[];
	displayName: string;
	iconUrl: string | null;
	needsAuth: boolean;
	service: string;
}

export interface OpenConnectorConnectionMeta {
	authType: string;
	configured: boolean;
	connectionName: string;
	id: string;
	service: string;
	virtual: boolean;
}

export interface OpenConnectorActionMeta {
	description: string;
	id: string;
	inputSchema: JsonSchema;
	name: string;
	service: string;
}

export interface OpenConnectorService {
	/** Connect a key-authenticated provider with the given credential values. */
	connectWithKey(input: {
		service: string;
		authType: string;
		values: Record<string, unknown>;
	}): Promise<{ configured: boolean }>;
	/** Remove a connection by provider service slug. */
	disconnect(service: string): Promise<void>;
	/** Execute one open-connector action server-side. */
	execute(input: { actionId: string; args: unknown }): Promise<ExecuteResult>;
	/** List the actions available (scoped to the given services). */
	listActions(services: string[]): Promise<OpenConnectorActionMeta[]>;
	/** List all connections. */
	listConnections(): Promise<OpenConnectorConnectionMeta[]>;
	/** List the open-connector provider catalog. */
	listProviders(): Promise<OpenConnectorProviderMeta[]>;
}

/** Turn open-connector action metas into runtime ToolDefs whose execute calls the service. */
export async function buildOpenConnectorToolDefs(
	service: OpenConnectorService,
	services: string[]
): Promise<ToolDef[]> {
	const metas = await service.listActions(services);
	return metas.map((meta) => ({
		name: meta.id,
		description: meta.description,
		parameters: meta.inputSchema,
		execute: (args) => service.execute({ actionId: meta.id, args }),
	}));
}
