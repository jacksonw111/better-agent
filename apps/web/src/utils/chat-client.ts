import { createUserSessionClientFrom } from "@jacksonw111/agent-client/internal";
import { client } from "@/utils/orpc";

export function userAgentClient(agentId: string) {
	return createUserSessionClientFrom(client, agentId);
}
