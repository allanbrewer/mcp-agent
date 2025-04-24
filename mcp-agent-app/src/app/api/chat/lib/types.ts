import { CoreMessage } from 'ai'; // Import CoreMessage

// Define the structure for the incoming request body using CoreMessage
export interface RequestBody {
    messages: CoreMessage[]; // Use CoreMessage array
    modelId?: string; // Add optional modelId
    providerId?: string; // Add optional providerId
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
    alwaysInitialize?: boolean; // Flag to always initialize this server
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