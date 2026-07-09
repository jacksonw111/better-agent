import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@better-agent/ui/components/tabs";

import type { AgentForm } from "./agent-form";
import { BuiltinToolsField } from "./builtin-tools-field";
import { ComposioAccountsField } from "./composio-accounts-field";
import { McpServersField } from "./mcp-servers-field";
import { OpenConnectorAccountsField } from "./openconnector-accounts-field";

type SetForm = (patch: Partial<AgentForm>) => void;

// Per-tool enable/disable moved to the chat composer's wrench menu — the
// wizard only picks the SOURCES, one tab per kind.
export function ToolsStep({ form, set }: { form: AgentForm; set: SetForm }) {
	return (
		<Tabs defaultValue="builtin">
			<TabsList className="w-full">
				<TabsTrigger value="builtin">Built-in</TabsTrigger>
				<TabsTrigger value="mcp">MCP</TabsTrigger>
				<TabsTrigger value="composio">Composio</TabsTrigger>
				<TabsTrigger value="openconnector">OpenConnector</TabsTrigger>
			</TabsList>
			<TabsContent className="pt-2" value="builtin">
				<BuiltinToolsField
					onChange={(ids) => set({ builtinTools: ids })}
					selected={form.builtinTools}
				/>
			</TabsContent>
			<TabsContent className="pt-2" value="mcp">
				<McpServersField
					onChange={(ids) => set({ mcpServerIds: ids })}
					selected={form.mcpServerIds}
				/>
			</TabsContent>
			<TabsContent className="pt-2" value="composio">
				<ComposioAccountsField
					onChange={(ids) => set({ composioAccountIds: ids })}
					selected={form.composioAccountIds}
				/>
			</TabsContent>
			<TabsContent className="pt-2" value="openconnector">
				<OpenConnectorAccountsField
					onChange={(ids) => set({ openConnectorAccountIds: ids })}
					selected={form.openConnectorAccountIds}
				/>
			</TabsContent>
		</Tabs>
	);
}
