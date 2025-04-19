// Define the structure for a message in the chat history
export interface Message {
    sender: 'user' | 'llm';
    text: string;
}

// Define the structure for the incoming request body
export interface RequestBody {
    messages: Message[];
    modelId?: string; // Add optional modelId
}

// --- MCP Server Configuration Interfaces ---
export interface McpToolParameterProperty { type: string; description?: string; }
export interface McpToolParameters { type: string; properties: Record<string, McpToolParameterProperty>; required?: string[]; }
export interface McpToolConfig { name: string; description: string; parameters: McpToolParameters; }
export interface McpServerCommandConfig {
    executableEnvVar?: string;
    defaultExecutable: string;
    argsTemplate: string[];
    scriptDirEnvVar?: string;
    envVars?: string[]; // Optional environment variables for the child process
    // Allow additional properties for specific server types (like GSuite)
    [key: string]: any; // Allows for gauthFileEnvVar, etc. without explicit definition everywhere
}
export interface McpServerConfig {
    id: string;
    description: string;
    command: McpServerCommandConfig;
    tools: McpToolConfig[];
}

// Define the overall structure of the config file
export interface McpConfig { servers: McpServerConfig[]; }
// --- End MCP Server Configuration Interfaces ---

// --- LLM Configuration Interfaces ---
export interface LlmModel {
    id: string;
    name: string;
}
export interface LlmProvider {
    id: string;
    name: string;
    models: LlmModel[];
    defaultModelId: string;
}
export interface LlmConfig {
    providers: LlmProvider[];
}
// --- End LLM Configuration Interfaces ---