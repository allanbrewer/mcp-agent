import path from 'path'; // Import path for resolving paths
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
import { RequestBody, McpConfig, McpServerConfig, LlmConfig, LlmProvider, LlmModel, McpToolConfig } from './lib/types'; // Removed Message import
import { loadMcpConfig } from './lib/mcp-config-loader'; // Keep config loader

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Load LLM config data
const llmConfig: LlmConfig = llmConfigData as LlmConfig;

// --- API Key Loading ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const XAI_API_KEY = process.env.XAI_API_KEY;

// --- Log API Key Status (Masked) ---
console.log(`[API Keys] Google: ${GOOGLE_API_KEY ? 'Loaded' : 'MISSING'}, OpenAI: ${OPENAI_API_KEY ? 'Loaded' : 'MISSING'}, Anthropic: ${ANTHROPIC_API_KEY ? 'Loaded' : 'MISSING'}, XAI: ${XAI_API_KEY ? 'Loaded' : 'MISSING'}`);
// ---


// --- Helper to prepare MCP Client Stdio Args ---
// Re-introducing this helper as StdioMCPTransport doesn't handle templating/env resolution automatically.
function prepareStdioArgs(serverConfig: McpServerConfig): { command: string; args: string[]; env: Record<string, string> } {
    console.log(`[prepareStdioArgs] Preparing args for server: ${serverConfig.id}`);
    const { command: commandConfig } = serverConfig;
    let command: string;
    let args: string[];
    // Start with an empty environment, only add required vars
    const childEnv: Record<string, string> = {};

    // --- Determine Command and Arguments ---
    const executableEnvVar = commandConfig.executableEnvVar;
    const defaultExecutable = commandConfig.defaultExecutable;
    const scriptDirEnvVar = commandConfig.scriptDirEnvVar; // Generic script dir var name from config
    const argsTemplate = commandConfig.argsTemplate || [];

    // Resolve executable path
    command = (executableEnvVar && process.env[executableEnvVar]) || defaultExecutable;
    if (!command) {
        throw new Error(`Could not determine executable for MCP server ${serverConfig.id}. Checked env var '${executableEnvVar}' and default '${defaultExecutable}'.`);
    }

    // Resolve generic script directory if needed and make absolute
    let scriptDir = scriptDirEnvVar ? process.env[scriptDirEnvVar] : undefined;
    if (scriptDir) {
        scriptDir = path.resolve(scriptDir); // Resolve to absolute path
        console.log(`[prepareStdioArgs][${serverConfig.id}] Generic Script Dir Env Var ('${scriptDirEnvVar}'): Resolved Path = '${scriptDir}'`);
    } else {
        console.log(`[prepareStdioArgs][${serverConfig.id}] Generic Script Dir Env Var ('${scriptDirEnvVar}'): Not Found/Set`);
    }
    if (argsTemplate.includes('{SCRIPT_DIR}') && !scriptDir) {
        const errorMsg = `Argument template for ${serverConfig.id} requires {SCRIPT_DIR}, but env var '${scriptDirEnvVar}' is not set.`;
        console.error(`[prepareStdioArgs][${serverConfig.id}] ${errorMsg}`);
        throw new Error(errorMsg);
    }

    // Substitute template variables
    args = argsTemplate.map(originalArg => {
        let processedArg = originalArg; // Start with the original argument

        // --- GitHub PAT Substitution ---
        if (serverConfig.id === 'github' && processedArg.includes('{GITHUB_PAT}')) {
            const githubPat = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
            if (!githubPat) throw new Error("Missing GITHUB_PERSONAL_ACCESS_TOKEN env var for GitHub server.");
            processedArg = processedArg.replace('{GITHUB_PAT}', githubPat);
            console.log(`[prepareStdioArgs] Substituted {GITHUB_PAT} in arg: ${originalArg} -> ${processedArg}`);
        }

        // --- GSuite Substitutions ---
        if (serverConfig.id === 'gsuite') {
            const gsuiteScriptDirEnvVar = (commandConfig as any).scriptDirEnvVar ?? 'GSUITE_MCP_SCRIPT_DIR';
            const gsuiteScriptDir = process.env[gsuiteScriptDirEnvVar];
            const gauthFileEnvVar = (commandConfig as any).gauthFileEnvVar ?? 'GSUITE_GAUTH_FILE';
            const gauthFile = process.env[gauthFileEnvVar];
            const accountsFileEnvVar = (commandConfig as any).accountsFileEnvVar ?? 'GSUITE_ACCOUNTS_FILE';
            const accountsFile = process.env[accountsFileEnvVar];
            const credentialsDirEnvVar = (commandConfig as any).credentialsDirEnvVar ?? 'GSUITE_CREDENTIALS_DIR';
            const credentialsDir = process.env[credentialsDirEnvVar];

            let gsuiteSubstituted = false;
            if (processedArg.includes('{GSUITE_MCP_SCRIPT_DIR}')) {
                if (!gsuiteScriptDir) throw new Error(`GSuite arg template needs {GSUITE_MCP_SCRIPT_DIR}, but env var '${gsuiteScriptDirEnvVar}' is not set.`);
                processedArg = processedArg.replace('{GSUITE_MCP_SCRIPT_DIR}', gsuiteScriptDir);
                gsuiteSubstituted = true;
            }
            if (processedArg.includes('{GSUITE_GAUTH_FILE}')) {
                if (!gauthFile) throw new Error(`GSuite arg template needs {GSUITE_GAUTH_FILE}, but env var '${gauthFileEnvVar}' is not set.`);
                processedArg = processedArg.replace('{GSUITE_GAUTH_FILE}', gauthFile);
                gsuiteSubstituted = true;
            }
            if (processedArg.includes('{GSUITE_ACCOUNTS_FILE}')) {
                if (!accountsFile) throw new Error(`GSuite arg template needs {GSUITE_ACCOUNTS_FILE}, but env var '${accountsFileEnvVar}' is not set.`);
                processedArg = processedArg.replace('{GSUITE_ACCOUNTS_FILE}', accountsFile);
                gsuiteSubstituted = true;
            }
            if (processedArg.includes('{GSUITE_CREDENTIALS_DIR}')) {
                if (!credentialsDir) throw new Error(`GSuite arg template needs {GSUITE_CREDENTIALS_DIR}, but env var '${credentialsDirEnvVar}' is not set.`);
                processedArg = processedArg.replace('{GSUITE_CREDENTIALS_DIR}', credentialsDir);
                gsuiteSubstituted = true;
            }
            if (gsuiteSubstituted) {
                console.log(`[prepareStdioArgs] Substituted GSuite vars in arg: ${originalArg} -> ${processedArg}`);
            }
        }

        // --- Generic {SCRIPT_DIR} Substitution (for non-GSuite/GitHub) ---
        // Check if it hasn't already been substituted by GSuite logic
        if (processedArg === '{SCRIPT_DIR}' && scriptDir) {
            processedArg = scriptDir;
            console.log(`[prepareStdioArgs] Substituted generic {SCRIPT_DIR} in arg: ${originalArg} -> ${processedArg}`);
        }

        // Log if no substitution occurred for a template-like string
        if (processedArg === originalArg && originalArg.includes('{') && originalArg.includes('}')) {
            console.warn(`[prepareStdioArgs] Arg '${originalArg}' looked like a template but no substitution was applied for server ${serverConfig.id}.`);
        }

        return processedArg; // Return the potentially modified argument
    });

    // Pass Thru ONLY Required Environment Variables specified in config
    if (commandConfig.envVars) {
        for (const envVarName of commandConfig.envVars) {
            const value = process.env[envVarName];
            if (value === undefined) {
                // Throw error if required env var is missing
                const errorMsg = `Required environment variable '${envVarName}' for MCP server ${serverConfig.id} is not set.`;
                console.error(`[prepareStdioArgs][${serverConfig.id}] ${errorMsg}`);
                throw new Error(errorMsg);
            }
            childEnv[envVarName] = value;
            console.log(`[prepareStdioArgs][${serverConfig.id}] Added required env var: ${envVarName}`);
        }
    }
    // Also ensure PATH is usually passed through, might be needed for `uv` or `docker`
    if (process.env.PATH) {
        childEnv['PATH'] = process.env.PATH;
    }

    // Return the minimal environment needed
    return { command, args, env: childEnv };
}


export async function POST(request: NextRequest) {
    try {
        const body: RequestBody = await request.json();
        // Log the raw body to see exactly what's coming from the frontend
        console.log("[Chat API] Received Body:", JSON.stringify(body, null, 2));
        const { messages, providerId: requestedProviderId, modelId: requestedModelId } = body;

        // --- Log received IDs ---
        console.log(`[Chat API] Parsed providerId: ${requestedProviderId}`);
        console.log(`[Chat API] Parsed modelId: ${requestedModelId}`);
        // ---

        if (!messages || messages.length === 0) {
            return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
        }

        // --- Determine Provider and Model ---
        const providerIdToUse = requestedProviderId || 'xai';
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
            console.log(`[MCP Init] Processing server: ${serverConfig.id}`);
            try {
                // Step 1: Use prepareStdioArgs to get resolved command, args, and env
                const { command, args, env } = prepareStdioArgs(serverConfig);

                console.log(`[MCP Init][${serverConfig.id}] Attempting to create client...`);
                const mcpClient = await createMCPClient({
                    transport: new StdioMCPTransport({
                        command: command, // Use resolved command
                        args: args,     // Use resolved args
                        env: env,       // Use filtered env
                    }),
                    // initializeParams: { ... } // Add if needed later
                });
                console.log(`[MCP Init][${serverConfig.id}] Client created successfully.`);
                mcpClients.push(mcpClient); // Store the client instance

                console.log(`[MCP Init][${serverConfig.id}] Attempting to fetch tools...`);
                const tools = await mcpClient.tools(); // Fetch tools
                console.log(`[MCP Init][${serverConfig.id}] Fetched ${Object.keys(tools).length} tools.`);
                return tools;
            } catch (error) {
                console.error(`Failed to create MCP client or fetch tools for server ${serverConfig.id}:`, error);
                // Step 2: Re-throw the error to make initialization failures explicit
                throw new Error(`Failed to initialize MCP server ${serverConfig.id}: ${error instanceof Error ? error.message : String(error)}`);
                // return {}; // Old behavior: continue with empty tools
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

        // --- Generate System Prompt ---
        // Using simplified prompt for now
        const dynamicSystemPrompt = "You are a helpful and informative assistant. You can answer questions, generate creative text formats, and provide information on a wide range of topics. You have access to external tools which include the ones available via MCP(Model Context Protocol) servers."

        // --- Call Vercel AI SDK streamText ---
        let result;
        try {
            console.log(`[Chat API] Calling streamText with provider ${providerIdToUse}...`);

            // WORKAROUND: Disable tools entirely for Anthropic due to SDK incompatibility
            let toolsForStream = mergedTools;
            if (['anthropic', 'openai'].includes(providerIdToUse)) {
                console.warn(`[Chat API] WORKAROUND: Disabling tools for ${providerIdToUse} due to SDK incompatibility with stdio tools.`);
                toolsForStream = {}; // Disable tools
            }

            result = await streamText({
                model: languageModel,
                system: dynamicSystemPrompt,
                messages: messages, // Pass messages directly from request body
                tools: toolsForStream, // Use conditional tools object
                maxSteps: 5, // Enable multi-step tool calling (will be ineffective for Anthropic if tools are {})
                // Add onFinish callback to close MCP clients
                onFinish: async ({ text, toolCalls, toolResults, finishReason, usage, warnings }) => { // Keep onFinish args for potential future debugging
                    console.log("Stream finished.");
                    console.log("[onFinish] Resolved Text:", text);
                    console.log("[onFinish] Resolved Tool Calls:", JSON.stringify(toolCalls, null, 2));
                    console.log("[onFinish] Resolved Tool Results:", JSON.stringify(toolResults, null, 2));
                    console.log("[onFinish] Finish Reason:", finishReason);
                    console.log("[onFinish] Usage:", JSON.stringify(usage, null, 2));
                    console.log("[onFinish] Warnings:", JSON.stringify(warnings, null, 2));

                    // Close MCP clients
                    console.log("[onFinish] Closing MCP clients...");
                    const closePromises = mcpClients.map(async (client, index) => {
                        try {
                            console.log(`[onFinish] Closing MCP client ${index + 1}...`);
                            await client.close();
                            console.log(`[onFinish] MCP client ${index + 1} closed.`);
                        } catch (closeError) {
                            console.error(`[onFinish] Error closing MCP client ${index + 1}:`, closeError);
                        }
                    });
                    await Promise.all(closePromises);
                    console.log("[onFinish] All MCP clients closed.");
                },
            });
            console.log("[Chat API] streamText call completed."); // Log after await
        } catch (streamError) {
            // Catch errors specifically from streamText
            console.error('[Chat API] Error during streamText execution:', streamError);
            // Ensure MCP clients are closed even if streamText fails
            console.log("[streamText Error] Closing MCP clients...");
            const closePromises = mcpClients.map(client => client.close().catch(e => console.error("Error closing MCP client after streamText error:", e)));
            await Promise.all(closePromises);
            console.log("[streamText Error] All MCP clients closed.");
            // Re-throw the error to be caught by the main handler
            throw streamError;
        }


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