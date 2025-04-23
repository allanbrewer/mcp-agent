import path from 'path';
import {
    experimental_createMCPClient as createMCPClient,
    type Tool, // Assuming Tool is the correct type for the value in ToolsObject
} from 'ai';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from 'ai/mcp-stdio';
import { McpConfig, McpServerConfig } from './types'; // Import necessary types

// Define the ToolsObject type based on Vercel AI SDK (adjust if needed)
type ToolsObject = Record<string, Tool>;

// Infer the client type correctly
type McpClient = Awaited<ReturnType<typeof createMCPClient>>;

export class McpClientManager {
    private readonly mcpConfig: McpConfig;
    private clients: Map<string, McpClient> = new Map();

    constructor(mcpConfig: McpConfig) {
        if (!mcpConfig || !Array.isArray(mcpConfig.servers)) {
            throw new Error("Invalid McpConfig provided to McpClientManager.");
        }
        this.mcpConfig = mcpConfig;
        console.log(`[McpClientManager] Initialized with ${this.mcpConfig.servers.length} total configured servers.`);
    }

    /**
     * Prepares command, arguments, and environment variables for launching an MCP server via Stdio.
     * Handles template substitution and environment variable filtering based on config.
     */
    private prepareStdioArgs(serverConfig: McpServerConfig): { command: string; args: string[]; env: Record<string, string> } {
        const { command: commandConfig } = serverConfig;
        if (!commandConfig) {
            throw new Error(`Missing 'command' configuration for MCP server ${serverConfig.id}. Cannot prepare stdio args.`);
        }

        let command: string;
        let args: string[];
        const childEnv: Record<string, string> = {}; // Start with minimal env

        // --- Resolve Executable (Remains Generic) ---
        const executableEnvVar = commandConfig.executableEnvVar;
        const defaultExecutable = commandConfig.defaultExecutable;
        command = (executableEnvVar && process.env[executableEnvVar]) || defaultExecutable;
        if (!command) {
            throw new Error(`Could not determine executable for MCP server ${serverConfig.id}. Checked env var '${executableEnvVar}' and default '${defaultExecutable}'.`);
        }

        // --- Substitute Args Template (Generic Loop) ---
        const argsTemplate = commandConfig.argsTemplate || [];
        // Cast argSubstitutions to the expected type, handling potential undefined
        const argSubstitutions = commandConfig.argSubstitutions as Record<string, string> | undefined;

        args = argsTemplate.map(originalArg => {
            let processedArg = originalArg;

            // Perform substitutions defined in the config
            if (argSubstitutions && Object.keys(argSubstitutions).length > 0) {
                for (const [placeholder, envVarName] of Object.entries(argSubstitutions)) {
                    if (processedArg.includes(placeholder)) {
                        const envValue = process.env[envVarName];
                        if (envValue === undefined) {
                            // Throw specific error if required env var for substitution is missing
                            throw new Error(`Configuration error for server '${serverConfig.id}': Argument placeholder '${placeholder}' requires environment variable '${envVarName}', which is not set.`);
                        }
                        // Use replaceAll to handle multiple occurrences
                        processedArg = processedArg.replaceAll(placeholder, envValue);
                        console.log(`[McpClientManager][prepareStdioArgs] Substituted '${placeholder}' in arg for server ${serverConfig.id}`);
                    }
                }
            }
            // No need for the old warning log about unsubstituted templates

            return processedArg;
        });

        // --- Filter Environment Variables (Remains Generic) ---
        if (commandConfig.envVars) {
            for (const envVarName of commandConfig.envVars) {
                const value = process.env[envVarName];
                if (value === undefined) {
                    const errorMsg = `Required environment variable '${envVarName}' for MCP server ${serverConfig.id} is not set.`;
                    console.error(`[McpClientManager][prepareStdioArgs][${serverConfig.id}] ${errorMsg}`);
                    throw new Error(errorMsg);
                }
                childEnv[envVarName] = value;
                console.log(`[McpClientManager][prepareStdioArgs][${serverConfig.id}] Added required env var: ${envVarName}`);
            }
        }
        // Ensure PATH is passed through if present
        if (process.env.PATH) {
            childEnv['PATH'] = process.env.PATH;
        }

        console.log(`[McpClientManager][prepareStdioArgs][${serverConfig.id}] Prepared: command='${command}', args='${args.join(' ')}'`);
        return { command, args, env: childEnv };
    }

    /**
     * Initializes MCP clients for the specified server IDs.
     */
    async initializeClients(serverIds: string[]): Promise<void> {
        console.log(`[McpClientManager] Attempting to initialize clients for IDs: ${serverIds.join(', ')}`);
        const serversToInitialize = this.mcpConfig.servers.filter(server => serverIds.includes(server.id));

        if (serversToInitialize.length !== serverIds.length) {
            const foundIds = serversToInitialize.map(s => s.id);
            const missingIds = serverIds.filter(id => !foundIds.includes(id));
            console.warn(`[McpClientManager] Could not find configuration for server IDs: ${missingIds.join(', ')}`);
        }

        const initPromises = serversToInitialize.map(async (serverConfig) => {
            if (this.clients.has(serverConfig.id)) {
                console.log(`[McpClientManager] Client for ${serverConfig.id} already initialized.`);
                return;
            }
            console.log(`[McpClientManager] Initializing client for: ${serverConfig.id}`);
            try {
                const { command, args, env } = this.prepareStdioArgs(serverConfig);

                const mcpClient = await createMCPClient({
                    transport: new StdioMCPTransport({ command, args, env }),
                    // initializeParams: { ... } // Add if needed
                });

                this.clients.set(serverConfig.id, mcpClient);
                console.log(`[McpClientManager] Successfully initialized client for: ${serverConfig.id}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`[McpClientManager] Failed to initialize MCP client for server ${serverConfig.id}:`, error);
                // Decide on error handling: throw, or just log and continue?
                // For now, re-throwing to make failures explicit during request processing.
                throw new Error(`Failed to initialize MCP server ${serverConfig.id}: ${errorMessage}`);
            }
        });

        await Promise.all(initPromises);
        console.log(`[McpClientManager] Finished initializing clients. Total initialized: ${this.clients.size}`);
    }

    /**
     * Fetches and merges tools from all currently initialized MCP clients.
     */
    async getMergedToolsForInitialized(): Promise<ToolsObject> {
        if (this.clients.size === 0) {
            console.log("[McpClientManager] No clients initialized, returning empty tools object.");
            return {};
        }

        console.log(`[McpClientManager] Fetching tools from ${this.clients.size} initialized clients...`);
        const toolPromises = Array.from(this.clients.entries()).map(async ([serverId, client]) => {
            try {
                const tools = await client.tools();
                const toolCount = Object.keys(tools).length;
                console.log(`[McpClientManager] Fetched ${toolCount} tools from ${serverId}`);
                return { serverId, tools };
            } catch (error) {
                console.error(`[McpClientManager] Failed to fetch tools from server ${serverId}:`, error);
                return { serverId, tools: {} }; // Return empty object on error for this server
            }
        });

        const allToolSets = await Promise.all(toolPromises);

        const mergedTools: ToolsObject = allToolSets.reduce((acc, { serverId, tools }) => {
            for (const toolName in tools) {
                if (acc[toolName]) {
                    // Duplicate detected! Prefix the new tool name.
                    const prefixedToolName = `${serverId}.${toolName}`;
                    console.warn(`[McpClientManager] Duplicate tool name '${toolName}' encountered (from server ${serverId}). Adding as '${prefixedToolName}'.`);
                    // Check if the prefixed name *also* conflicts (unlikely but possible)
                    if (acc[prefixedToolName]) {
                        console.error(`[McpClientManager] CRITICAL: Prefixed tool name '${prefixedToolName}' also conflicts! Overwriting.`);
                    }
                    acc[prefixedToolName] = tools[toolName];
                } else {
                    // No conflict, add normally.
                    acc[toolName] = tools[toolName];
                }
            }
            return acc;
        }, {} as ToolsObject);

        console.log(`[McpClientManager] Merged tools from initialized clients. Total tools: ${Object.keys(mergedTools).length}`);
        return mergedTools;
    }

    /**
     * Closes all currently initialized MCP clients.
     */
    async closeInitializedClients(): Promise<void> {
        if (this.clients.size === 0) {
            console.log("[McpClientManager] No clients to close.");
            return;
        }
        console.log(`[McpClientManager] Closing ${this.clients.size} initialized clients...`);
        const closePromises = Array.from(this.clients.entries()).map(async ([serverId, client]) => {
            try {
                await client.close();
                console.log(`[McpClientManager] Closed client for ${serverId}`);
            } catch (closeError) {
                console.error(`[McpClientManager] Error closing MCP client ${serverId}:`, closeError);
            }
        });

        await Promise.all(closePromises);
        this.clients.clear(); // Clear the map after closing
        console.log("[McpClientManager] All initialized clients closed.");
    }
}