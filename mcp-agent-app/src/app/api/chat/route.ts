import { NextRequest, NextResponse } from 'next/server';
import {
    streamText,
    CoreMessage,
    experimental_createMCPClient as createMCPClient, // Import MCP Client creator
    // MCPClient type is not exported, use ReturnType later
} from 'ai';
// Import the Stdio Transport
import { Experimental_StdioMCPTransport as StdioMCPTransport } from 'ai/mcp-stdio';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createXai } from '@ai-sdk/xai';
// import { z } from 'zod'; // No longer needed for manual schema conversion

import llmConfigData from '../../../../llm-config.json';

// Import types
import { Message, RequestBody as OldRequestBody, McpConfig, McpServerConfig, LlmConfig, LlmProvider, LlmModel, McpToolConfig } from './lib/types';
import { loadMcpConfig } from './lib/mcp-config-loader'; // Keep config loader

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Define updated RequestBody type
interface RequestBody extends OldRequestBody {
    providerId?: string;
}

// Load LLM config data
const llmConfig: LlmConfig = llmConfigData as LlmConfig;

// --- API Key Loading ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const XAI_API_KEY = process.env.XAI_API_KEY;

// --- Helper to map internal messages to CoreMessage ---
function mapMessagesToCoreMessages(messages: Message[]): CoreMessage[] {
    return messages.map((msg): CoreMessage => {
        if (msg.sender === 'user') {
            return { role: 'user', content: msg.text };
        } else { // msg.sender === 'llm'
            return { role: 'assistant', content: msg.text };
        }
    });
}

// --- Helper to prepare MCP Client Stdio Args ---
// This adapts logic previously in executeMcpTool
function prepareStdioArgs(serverConfig: McpServerConfig): { command: string; args: string[]; env: Record<string, string> } {
    const { command: commandConfig } = serverConfig;
    let command: string;
    let args: string[];
    const childEnv = { ...process.env }; // Start with current environment

    // --- Determine Command and Arguments (Simplified adaptation) ---
    // This needs careful testing and might require adjustments based on specific server needs
    const executableEnvVar = commandConfig.executableEnvVar;
    const defaultExecutable = commandConfig.defaultExecutable;
    const scriptDirEnvVar = commandConfig.scriptDirEnvVar;
    const argsTemplate = commandConfig.argsTemplate || [];

    // Resolve executable path
    command = (executableEnvVar && process.env[executableEnvVar]) || defaultExecutable;
    if (!command) {
        throw new Error(`Could not determine executable for MCP server ${serverConfig.id}. Checked env var '${executableEnvVar}' and default '${defaultExecutable}'.`);
    }

    // Resolve script directory if needed
    const scriptDir = scriptDirEnvVar ? process.env[scriptDirEnvVar] : undefined;
    if (argsTemplate.includes('{SCRIPT_DIR}') && !scriptDir) {
        throw new Error(`Argument template for ${serverConfig.id} requires {SCRIPT_DIR}, but env var '${scriptDirEnvVar}' is not set.`);
    }

    // Substitute template variables
    // TODO: Add more robust templating if needed (e.g., GITHUB_PAT, GSUITE vars)
    args = argsTemplate.map(arg => {
        if (arg === '{SCRIPT_DIR}' && scriptDir) {
            return scriptDir;
        }
        // Add other substitutions here as needed (e.g., GITHUB_PAT)
        if (serverConfig.id === 'github' && arg.includes('{GITHUB_PAT}')) {
            const githubPat = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
            if (!githubPat) throw new Error("Missing GITHUB_PERSONAL_ACCESS_TOKEN env var for GitHub server.");
            return arg.replace('{GITHUB_PAT}', githubPat);
        }
        // Add GSuite substitutions if necessary
        // ...

        return arg;
    });

    // Pass Thru Environment Variables
    if (commandConfig.envVars) {
        for (const envVarName of commandConfig.envVars) {
            const value = process.env[envVarName];
            if (value === undefined) {
                throw new Error(`Required environment variable '${envVarName}' for MCP server ${serverConfig.id} is not set.`);
            }
            childEnv[envVarName] = value;
        }
    }

    // Filter out process.env properties that might cause issues if passed directly
    // This is a basic filter, might need refinement
    const filteredEnv: Record<string, string> = {};
    for (const key in childEnv) {
        if (childEnv[key] !== undefined) {
            filteredEnv[key] = childEnv[key] as string;
        }
    }


    return { command, args, env: filteredEnv };
}


export async function POST(request: NextRequest) {
    try {
        const body: RequestBody = await request.json();
        const { messages, providerId: requestedProviderId, modelId: requestedModelId } = body;

        if (!messages || messages.length === 0) {
            return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
        }

        // --- Determine Provider and Model ---
        const providerIdToUse = requestedProviderId || 'google';
        const providerConfig = llmConfig.providers.find(p => p.id === providerIdToUse);
        if (!providerConfig) {
            throw new Error(`Configuration for provider '${providerIdToUse}' not found.`);
        }
        const defaultModelId = providerConfig.defaultModelId;
        const modelIdToUse = requestedModelId && providerConfig.models.some(m => m.id === requestedModelId)
            ? requestedModelId
            : defaultModelId;
        if (!modelIdToUse) {
            throw new Error(`Could not determine model ID for provider '${providerIdToUse}'.`);
        }
        console.log(`Using Provider: ${providerIdToUse}, Model: ${modelIdToUse}`);

        // --- Instantiate LLM Provider ---
        let languageModel;
        switch (providerIdToUse) {
            case 'google':
                if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set");
                languageModel = createGoogleGenerativeAI({ apiKey: GOOGLE_API_KEY })(modelIdToUse);
                break;
            case 'openai':
                if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
                languageModel = createOpenAI({ apiKey: OPENAI_API_KEY })(modelIdToUse);
                break;
            case 'anthropic':
                if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
                languageModel = createAnthropic({ apiKey: ANTHROPIC_API_KEY })(modelIdToUse);
                break;
            case 'xai':
                if (!XAI_API_KEY) throw new Error("XAI_API_KEY not set");
                languageModel = createXai({ apiKey: XAI_API_KEY })(modelIdToUse);
                break;
            default:
                throw new Error(`Unsupported provider ID: ${providerIdToUse}`);
        }

        // --- Load MCP Config & Prepare Clients ---
        const mcpConfig = await loadMcpConfig();
        // Infer the client type using ReturnType on the awaited promise result
        const mcpClients: Awaited<ReturnType<typeof createMCPClient>>[] = [];
        const mcpToolsPromises = mcpConfig.servers.map(async (serverConfig) => {
            try {
                const { command, args, env } = prepareStdioArgs(serverConfig);
                console.log(`Preparing MCP Client for ${serverConfig.id}: ${command} ${args.join(' ')}`);
                // Use StdioMCPTransport instance directly for the transport property
                const mcpClient = await createMCPClient({
                    transport: new StdioMCPTransport({
                        command: command,
                        args: args,
                        env: env,
                    }),
                    // Add initialization options if needed
                    // initializeParams: { ... }
                });
                mcpClients.push(mcpClient); // Store the client instance
                // Fetch tools from this client
                const tools = await mcpClient.tools();
                console.log(`Fetched ${Object.keys(tools).length} tools from MCP server: ${serverConfig.id}`);
                return tools;
            } catch (error) {
                console.error(`Failed to create MCP client or fetch tools for server ${serverConfig.id}:`, error);
                return {}; // Return empty object on error for this client
            }
        });

        // --- Merge Tools from All Clients ---
        const allToolSets = await Promise.all(mcpToolsPromises);
        const mergedTools = allToolSets.reduce((acc, toolSet) => {
            // Basic merge, warn on overwrite
            for (const toolName in toolSet) {
                if (acc[toolName]) {
                    console.warn(`Duplicate tool name '${toolName}' encountered during MCP client merge. Overwriting previous definition.`);
                }
                acc[toolName] = toolSet[toolName];
            }
            return acc;
        }, {});
        console.log(`Total MCP tools merged: ${Object.keys(mergedTools).length}`);

        // --- Map Messages ---
        const coreMessages = mapMessagesToCoreMessages(messages);

        // --- Generate System Prompt ---
        // TODO: Re-evaluate system prompt. Does it need tool list? SDK might handle this.
        const dynamicSystemPrompt = "You are a helpful assistant. Use the available tools when necessary.";
        console.log("Using System Prompt:", dynamicSystemPrompt);

        // --- Call Vercel AI SDK streamText ---
        const result = await streamText({
            model: languageModel,
            system: dynamicSystemPrompt,
            messages: coreMessages,
            tools: mergedTools,
            // Add onFinish to close MCP clients
            onFinish: async () => {
                console.log("LLM stream finished. Closing MCP clients...");
                // Use inferred type for client
                await Promise.all(mcpClients.map((client) => client.close().catch((err: any) => console.error(`Error closing MCP client:`, err)))); // Removed client object logging as it might be complex
                console.log("MCP clients closed.");
            },
        });

        // --- Return Streaming Response ---
        return new Response(result.toDataStream(), {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error) {
        console.error('[Chat API Error]', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return NextResponse.json({ error: `Failed to process chat request: ${errorMessage}` }, { status: 500 });
    }
}