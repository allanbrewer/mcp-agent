import fs from 'fs/promises'; // Use promises API for async operations
import path from 'path'; // Import path for resolving config file path
import { McpConfig, McpServerConfig } from './types'; // Import types

// --- MCP Configuration Loading ---
const MCP_CONFIG_PATH = path.resolve(process.cwd(), 'mcp-config.json');

let loadedMcpConfig: McpConfig | null = null; // In-memory cache

export async function loadMcpConfig(): Promise<McpConfig> {
    if (loadedMcpConfig) {
        return loadedMcpConfig;
    }
    try {
        console.log(`Attempting to load MCP config from: ${MCP_CONFIG_PATH}`);
        const fileContent = await fs.readFile(MCP_CONFIG_PATH, 'utf-8');
        // TODO: Add schema validation (e.g., using Zod) later
        const config = JSON.parse(fileContent) as McpConfig;
        if (!config || !Array.isArray(config.servers)) {
            throw new Error("Invalid config format: 'servers' array not found.");
        }
        loadedMcpConfig = config; // Cache it
        console.log(`MCP config loaded successfully with ${config.servers.length} server(s).`);
        return config;
    } catch (error: any) {
        console.error(`Failed to load or parse MCP config from ${MCP_CONFIG_PATH}:`, error);
        // Return empty config on error to prevent crashing, but log the error
        return { servers: [] }; // Return default empty config
    }
}
// --- End MCP Configuration Loading ---

// Removed getServerConfigForTool as it's no longer needed with createMCPClient