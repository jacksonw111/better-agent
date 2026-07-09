// Open-connector port types, split out of ports.ts so that file stays under
// the repo's 300-line limit. Self-contained (no imports back into ports.ts)
// to avoid a circular type-only dependency; ports.ts re-exports these.

/** An open-connector account as exposed to clients: never includes token ciphers. */
export interface OpenConnectorAccountRow {
	adminTokenLast4: string;
	baseUrl: string;
	createdAt: Date;
	id: string;
	name: string;
	runtimeTokenLast4: string;
	/** Owner; null for legacy admin-era accounts. */
	userId: string | null;
}

export interface OpenConnectorAccountStore {
	create(input: {
		name: string;
		baseUrl: string;
		adminToken: string;
		runtimeToken: string;
		userId?: string;
	}): Promise<OpenConnectorAccountRow>;
	delete(id: string): Promise<void>;
	getById(id: string): Promise<OpenConnectorAccountRow | null>;
	/** Decrypted tokens — server-side only, for building an OpenConnectorService. */
	getSecrets(id: string): Promise<{
		baseUrl: string;
		adminToken: string;
		runtimeToken: string;
	} | null>;
	list(): Promise<OpenConnectorAccountRow[]>;
	listByUser(userId: string): Promise<OpenConnectorAccountRow[]>;
}
