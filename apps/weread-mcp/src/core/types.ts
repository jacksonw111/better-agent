export interface ToolResult {
	content: { type: "text"; text: string }[];
	isError: boolean;
}

export interface ToolEnv {
	API_TOKEN?: string;
	WEREAD_API_KEY?: string;
}
