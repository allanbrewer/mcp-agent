import path from 'path';
import fs from 'fs/promises'; // Use promises API for async operations
import { NextRequest, NextResponse } from 'next/server';
import {
    streamText,
    generateText, // Added for lightweight LLM call
    experimental_createMCPClient as createMCPClient,
} from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createXai } from '@ai-sdk/xai';

// Import types
import { RequestBody, LlmConfig } from './lib/types';
import { loadMcpConfig } from './lib/mcp-config-loader';
import { McpClientManager } from './lib/mcp-client-manager'; // Import the manager
import { getPopulatedSystemPrompt } from './lib/system-prompt'; // Import the new prompt function

// Load LLM config data
const LLM_CONFIG_PATH = path.resolve(process.cwd(), 'llm-config.json');
console.log(`Attempting to load MCP config from: ${LLM_CONFIG_PATH}`);
const fileContent = await fs.readFile(LLM_CONFIG_PATH, 'utf-8');
const llmConfigData = JSON.parse(fileContent);

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Load LLM config data
const llmConfig: LlmConfig = llmConfigData as LlmConfig;

// --- API Key Loading ---
const LITE_GOOGLE_API_KEY = process.env.LITE_GOOGLE_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const XAI_API_KEY = process.env.XAI_API_KEY;

// --- Log API Key Status (Masked) ---
console.log(`[API Keys] Lite Google: ${LITE_GOOGLE_API_KEY ? 'Loaded' : 'MISSING'}, Google: ${GOOGLE_API_KEY ? 'Loaded' : 'MISSING'}, OpenAI: ${OPENAI_API_KEY ? 'Loaded' : 'MISSING'}, Anthropic: ${ANTHROPIC_API_KEY ? 'Loaded' : 'MISSING'}, XAI: ${XAI_API_KEY ? 'Loaded' : 'MISSING'}`);



// --- Lightweight LLM for Tool Selection ---
// Assuming Google provider and a flash model ID exists in llm-config.json or is added.
// Using 'gemini-1.5-flash-latest' as a placeholder. Adjust if needed.
const TOOL_SELECTOR_PROVIDER_ID = 'google';
const TOOL_SELECTOR_MODEL_ID = 'gemini-1.5-flash-latest'; // Placeholder
let toolSelectorModel: ReturnType<ReturnType<typeof createGoogleGenerativeAI>>;
if (LITE_GOOGLE_API_KEY) {
    try {
        const googleProvider = createGoogleGenerativeAI({ apiKey: LITE_GOOGLE_API_KEY });
        toolSelectorModel = googleProvider(TOOL_SELECTOR_MODEL_ID);
        console.log(`[Tool Selector] Initialized ${TOOL_SELECTOR_PROVIDER_ID}/${TOOL_SELECTOR_MODEL_ID}`);
    } catch (e) {
        console.error(`[Tool Selector] Failed to initialize ${TOOL_SELECTOR_PROVIDER_ID}/${TOOL_SELECTOR_MODEL_ID}:`, e);
        // Handle error - perhaps fall back to using all tools?
    }
} else {
    console.warn(`[Tool Selector] LITE_GOOGLE_API_KEY not set. Tool selection LLM disabled.`);
}


export async function POST(request: NextRequest) {
    let mcpManager: McpClientManager | null = null; // Initialize manager variable

    try {
        const body: RequestBody = await request.json();
        const { messages, providerId: requestedProviderId, modelId: requestedModelId } = body;

        if (!messages || messages.length === 0) {
            return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
        }
        const latestUserMessage = messages[messages.length - 1]?.content;
        if (typeof latestUserMessage !== 'string') {
            return NextResponse.json({ error: 'Last message content is invalid or missing' }, { status: 400 });
        }


        // --- Determine Primary Provider and Model ---
        const providerIdToUse = requestedProviderId || 'xai'; // Default primary provider
        const providerConfig = llmConfig.providers.find(p => p.id === providerIdToUse);
        if (!providerConfig) {
            throw new Error(`Configuration for primary provider '${providerIdToUse}' not found.`);
        }
        const defaultModelId = providerConfig.defaultModelId;
        const modelIdToUse = requestedModelId && providerConfig.models.some(m => m.id === requestedModelId)
            ? requestedModelId
            : defaultModelId;
        if (!modelIdToUse) {
            throw new Error(`Could not determine primary model ID for provider '${providerIdToUse}'.`);
        }
        console.log(`Using Primary Provider: ${providerIdToUse}, Model: ${modelIdToUse}`);

        // --- Instantiate Primary LLM Provider ---
        let primaryLanguageModel;
        switch (providerIdToUse) {
            case 'google':
                if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set for primary model");
                primaryLanguageModel = createGoogleGenerativeAI({ apiKey: GOOGLE_API_KEY })(modelIdToUse);
                break;
            case 'openai':
                if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set for primary model");
                primaryLanguageModel = createOpenAI({ apiKey: OPENAI_API_KEY })(modelIdToUse);
                break;
            case 'anthropic':
                if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set for primary model");
                primaryLanguageModel = createAnthropic({ apiKey: ANTHROPIC_API_KEY })(modelIdToUse);
                break;
            case 'xai':
                if (!XAI_API_KEY) throw new Error("XAI_API_KEY not set for primary model");
                primaryLanguageModel = createXai({ apiKey: XAI_API_KEY })(modelIdToUse);
                break;
            default:
                throw new Error(`Unsupported primary provider ID: ${providerIdToUse}`);
        }

        // --- Load MCP Config ---
        const mcpConfig = await loadMcpConfig();
        const availableServerIds = mcpConfig.servers.map(s => s.id);
        let neededServerIds: string[] = [];

        // --- Step 1: Predict Relevant Servers (if tool selector is available) ---
        if (toolSelectorModel && availableServerIds.length > 0) {
            console.log('[Tool Selection] Predicting relevant servers...');
            try {
                const predictionPrompt = `Based on the user query "${latestUserMessage}", which of these MCP servers seem relevant? Respond ONLY with a comma-separated list of their IDs (e.g., "github, whatsapp, gmail, web search, etc"). If none seem relevant, respond with "NONE". Available servers: ${availableServerIds.join(', ')}.`;

                const { text: predictionResult } = await generateText({
                    model: toolSelectorModel,
                    prompt: predictionPrompt,
                    // Add temperature or other settings if needed
                });
                console.log(`[Tool Selection] Prediction result: "${predictionResult}"`);

                if (predictionResult && predictionResult.toUpperCase() !== 'NONE') {
                    // Improved parsing: split, trim, filter out empty strings, then filter against available IDs
                    neededServerIds = predictionResult
                        .split(',')
                        .map(id => id.trim())
                        .filter(id => id)
                        .filter(id => availableServerIds.includes(id));
                }
                console.log(`[Tool Selection] Determined needed server IDs: ${neededServerIds.length > 0 ? neededServerIds.join(', ') : 'None'}`);
                // Removed data.append for tool_selection_finished

            } catch (predictionError) {
                // const errorMessage = predictionError instanceof Error ? predictionError.message : String(predictionError);
                console.error('[Tool Selection] Error during prediction:', predictionError);
                // Fallback strategy: Use all servers? Or none? For now, use none on error.
                neededServerIds = [];
                console.warn('[Tool Selection] Falling back to using NO tools due to prediction error.');
            }
        } else if (availableServerIds.length > 0) {
            console.warn('[Tool Selection] Tool selector LLM not available or no servers configured. Skipping tool selection step. NO tools will be used.');
            neededServerIds = []; // Use no tools if selector isn't available
        }


        // --- Step 2 & 3: Initialize Manager & Relevant Clients ---
        mcpManager = new McpClientManager(mcpConfig); // Instantiate the manager
        // Always call initializeClients. The manager will handle merging alwaysInitialize servers.
        // Pass the potentially empty neededServerIds array.
        await mcpManager.initializeClients(neededServerIds);


        // --- Step 4: Get Tools & Call streamText ---
        const relevantTools = await mcpManager.getMergedToolsForInitialized();

        // --- Get Populated System Prompt ---
        // TODO: Pass actual location from request body if available
        const populatedSystemPrompt = getPopulatedSystemPrompt();

        // --- Call Vercel AI SDK streamText ---
        let result;
        try {
            let toolsForStream = relevantTools;

            result = await streamText({
                model: primaryLanguageModel,
                system: populatedSystemPrompt, // Use the populated prompt
                messages: messages,
                tools: toolsForStream,
                maxSteps: 15,
                temperature: 1,
                topK: 20,
                maxTokens: 4096,
                onFinish: async (finishData) => {
                    console.log("Stream finished.", finishData);
                    // Close only the initialized clients via the manager
                    if (mcpManager) {
                        await mcpManager.closeInitializedClients();
                    }
                },
            });
        } catch (streamError) {
            console.error('[Chat API] Error during streamText execution:', streamError);
            // Ensure initialized MCP clients are closed even if streamText fails
            if (mcpManager) {
                await mcpManager.closeInitializedClients();
            }
            throw streamError;
        }


        // --- Return Streaming Response ---
        // Use toDataStreamResponse() which formats the stream correctly for useChat
        return result.toDataStreamResponse();

    } catch (error) {
        console.error('[Chat API Error]', error);
        // Ensure manager closes clients if an error occurred before streamText onFinish
        if (mcpManager) {
            await mcpManager.closeInitializedClients().catch(closeError => {
                console.error('[Chat API Error] Failed to close MCP clients during error handling:', closeError);
            });
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return NextResponse.json({ error: `Failed to process chat request: ${errorMessage}` }, { status: 500 });
    }
}