import { NextResponse, NextRequest } from 'next/server'; // Added NextRequest
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Content, Part, FunctionDeclaration, Tool, FunctionCallingConfigMode, Type } from '@google/genai';
import llmConfigData from '../../../../llm-config.json'; // Import LLM config

// Import types and refactored functions
import { Message, RequestBody, McpConfig, McpServerConfig, LlmConfig, LlmProvider, LlmModel } from './lib/types'; // Added LlmProvider, LlmModel
import { loadMcpConfig } from './lib/mcp-config-loader';
import {
    mapMessagesToGemini,
    detectRelevantServers,
    generateSystemPrompt,
    tools,
    formatToolResultForGemini
} from './lib/gemini-helpers';
import { executeMcpTool } from './lib/mcp-tool-executor';


// Load environment variables
import dotenv from 'dotenv';
import fs from 'fs/promises'; // Use promises API for async operations
import path from 'path'; // Import path for resolving config file path

dotenv.config({ path: '.env.local' }); // Ensure .env.local is loaded

// Load LLM config data (but process it inside the request handler)
const llmConfig: LlmConfig = llmConfigData as LlmConfig;


const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
    throw new Error("GOOGLE_API_KEY environment variable not set");
}

const genAI = new GoogleGenAI({ apiKey: API_KEY }); // Correct instantiation


const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 8192,
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];



// Helper to format data for SSE
const formatSseMessage = (type: string, data: any): string => {
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
};

export async function POST(request: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const enqueue = (type: string, data: any) => {
                try {
                    controller.enqueue(encoder.encode(formatSseMessage(type, data)));
                } catch (e) {
                    console.error("Error encoding/enqueuing SSE message:", e);
                    // Optionally close stream here if encoding fails critically
                }
            };

            try {
                // --- Find Google Provider and Default Model ID ---
                // Moved inside the try block for correct type narrowing
                const googleProvider = llmConfig.providers.find((p: LlmProvider) => p.id === 'google');
                if (!googleProvider) {
                    // This error will be caught by the outer catch block
                    throw new Error("Google provider configuration not found in llm-config.json");
                }
                const DEFAULT_MODEL_ID = googleProvider.defaultModelId;
                // --- End Provider/Default ID ---

                const mcpConfig = await loadMcpConfig();
                const body: RequestBody = await request.json();
                // Extract messages and modelId from body
                const { messages, modelId: requestedModelId } = body;

                // Determine the model ID to use: request body or default from config
                // Also validate if the requested model is actually in our config for Google
                // Add explicit type for m
                // Now googleProvider is guaranteed to be defined here
                const modelIdToUse = requestedModelId && googleProvider.models.some((m: LlmModel) => m.id === requestedModelId)
                    ? requestedModelId
                    : DEFAULT_MODEL_ID;
                console.log(`Using model ID: ${modelIdToUse}`); // Log the selected model

                if (!messages || messages.length === 0) {
                    enqueue('error', { message: 'No messages provided' });
                    controller.close();
                    return;
                }

                const mappedMessages = mapMessagesToGemini(messages);

                if (mappedMessages.length === 0) {
                    enqueue('error', { message: 'Cannot start chat with empty mapped messages' });
                    controller.close();
                    return;
                }

                // Get the original text from the latest user message in the request body
                const latestUserMessage = messages[messages.length - 1];
                const promptText = latestUserMessage.text;

                const latestMessage = mappedMessages[mappedMessages.length - 1]; // Keep this for chat history logic
                let chatHistoryForStart = mappedMessages.slice(0, -1);

                // Prepare history for startChat: Ensure it starts with 'user' or is empty.
                if (chatHistoryForStart.length > 0 && chatHistoryForStart[0].role === 'model') {
                    const firstUserIndex = chatHistoryForStart.findIndex(msg => msg.role === 'user');
                    if (firstUserIndex !== -1) {
                        chatHistoryForStart = chatHistoryForStart.slice(firstUserIndex);
                    } else {
                        chatHistoryForStart = [];
                    }
                }

                // Detect relevant servers based on the prompt
                const relevantServerIds = detectRelevantServers(promptText, mcpConfig);

                // Generate the dynamic system prompt using the helper function and relevant server IDs
                const dynamicSystemPrompt = generateSystemPrompt(mcpConfig, relevantServerIds);
                console.log("Using Dynamic System Prompt:", dynamicSystemPrompt); // Keep log for debugging

                // Create the system instruction object for Gemini
                const systemInstruction: Content = { role: 'system', parts: [{ text: dynamicSystemPrompt }] }; // Use 'system' role for system instructions

                const chat = genAI.chats.create({
                    model: modelIdToUse, // Use the determined model ID
                    history: chatHistoryForStart,
                    config: {
                        ...generationConfig,
                        safetySettings,
                        tools: tools, // Use the renamed 'tools' constant
                        systemInstruction: systemInstruction,
                        // toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } } // Consider ANY mode if AUTO struggles with tool calls
                    }
                });

                // --- Start Conversation Loop ---
                let currentPrompt: string | Part[] = latestMessage.parts ?? [];
                let safetyAlert = false;

                // Limit conversation turns to prevent infinite loops or excessive cost
                for (let i = 0; i < 5; i++) {
                    console.log(`--- Loop ${i + 1}: Sending to Gemini ---`);
                    enqueue('status', { message: `Thinking... (Turn ${i + 1})` });

                    // Prepare parts for sendMessageStream
                    const messageToSendParts: Part[] = [];
                    if (typeof currentPrompt === 'string') {
                        messageToSendParts.push({ text: currentPrompt });
                    } else if (Array.isArray(currentPrompt)) {
                        currentPrompt.forEach(part => {
                            messageToSendParts.push(part);
                        });
                    }

                    // Use sendMessageStream - ensure message is in the correct format
                    // The message property should contain the parts array or a string
                    const messageForStream = { message: messageToSendParts };
                    const resultStream = await chat.sendMessageStream(messageForStream);


                    let accumulatedText = ""; // Accumulate text chunks for this turn
                    let functionCallDetected = false;
                    const toolResponses: Part[] = []; // Store tool responses for this turn

                    // Process the stream
                    for await (const response of resultStream) {
                        // --- Response Validation and Safety Checks ---
                        if (!response.candidates || response.candidates.length === 0) {
                            console.error('Gemini API stream response missing candidates:', response);
                            if (response.promptFeedback?.blockReason) {
                                console.warn(`Prompt blocked due to ${response.promptFeedback.blockReason}`);
                                safetyAlert = true;
                                enqueue('error', { message: `Prompt blocked due to ${response.promptFeedback.blockReason}` });
                                controller.close(); return;
                            }
                            enqueue('error', { message: 'LLM returned no candidates or unexpected response structure' });
                            controller.close(); return;
                        }

                        if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
                            console.warn("Gemini response blocked due to safety settings.");
                            safetyAlert = true;
                            enqueue('error', { message: "Response blocked by safety settings." });
                            controller.close(); return;
                        }

                        // --- Function Call Handling ---
                        const functionCallParts = response.candidates?.[0]?.content?.parts?.filter((part: Part) => !!part.functionCall) ?? [];
                        const functionCalls = functionCallParts.map((part: Part) => part.functionCall).filter((fc): fc is NonNullable<Part['functionCall']> => !!fc);

                        if (functionCalls.length > 0) {
                            functionCallDetected = true; // Mark that a function call happened in this stream response
                            console.log("Function call(s) detected in stream:", JSON.stringify(functionCalls, null, 2));

                            // Process all function calls requested in this chunk (usually just one per chunk)
                            for (const functionCall of functionCalls) {
                                const requestedToolName = functionCall.name;
                                const toolArgs = functionCall.args;
                                let formattedResponsePart: Part;

                                if (!requestedToolName) {
                                    console.error("Function call received without a name:", JSON.stringify(functionCall, null, 2));
                                    formattedResponsePart = formatToolResultForGemini("unknown_tool", { error: "Function call received without a tool name." });
                                } else if (requestedToolName === "use_mcp_tool") {
                                    const { serverName, toolName: actualToolName, arguments: actualArgs } = toolArgs ?? {};

                                    if (!serverName || !actualToolName) {
                                        console.error("Missing serverName or toolName for use_mcp_tool:", toolArgs);
                                        formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: "Missing required parameters: serverName and/or toolName." });
                                    } else {
                                        enqueue('log', { message: `Executing tool: ${serverName}/${actualToolName}...` });
                                        console.log(`Attempting to execute MCP tool: Server='${serverName}', Tool='${actualToolName}', Args=`, actualArgs);
                                        const serverConfig = mcpConfig.servers.find(s => s.id === serverName);

                                        if (!serverConfig) {
                                            console.error(`MCP Server config not found for ID: ${serverName}`);
                                            formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Configuration for MCP server '${serverName}' not found.` });
                                            enqueue('error', { message: `Configuration for MCP server '${serverName}' not found.` });
                                        } else {
                                            const toolExists = serverConfig.tools.some(t => t.name === actualToolName);
                                            if (!toolExists) {
                                                console.error(`Tool '${actualToolName}' not found in configuration for server '${serverName}'.`);
                                                formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Tool '${actualToolName}' is not defined for server '${serverName}'.` });
                                                enqueue('error', { message: `Tool '${actualToolName}' is not defined for server '${serverName}'.` });
                                            } else if (typeof actualToolName !== 'string' || actualToolName === '') {
                                                console.error(`Invalid tool name provided for server '${serverName}':`, actualToolName);
                                                formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Invalid tool name provided.` });
                                                enqueue('error', { message: `Invalid tool name provided.` });
                                            } else {
                                                try {
                                                    const toolResult = await executeMcpTool(serverConfig, actualToolName, (actualArgs ?? {}) as any);
                                                    console.log(`executeMcpTool call successful for ${serverName}/${actualToolName}. Result:`, toolResult);
                                                    enqueue('log', { message: `Tool ${serverName}/${actualToolName} executed successfully.` }); // Keep log event

                                                    // --- Add tool_completed event ---
                                                    const summary = `Used ${serverName}: ${actualToolName.replace(/_/g, ' ')}`;
                                                    enqueue('tool_completed', { summary: summary });
                                                    // --- End tool_completed event ---

                                                    formattedResponsePart = {
                                                        functionResponse: {
                                                            name: "use_mcp_tool", // Still need to send the result back to Gemini
                                                            response: { content: toolResult },
                                                        },
                                                    };
                                                } catch (error: any) {
                                                    console.error(`executeMcpTool call failed for ${serverName}/${actualToolName}: ${error.message}`, error);
                                                    enqueue('error', { message: `Tool execution failed: ${error.message}` });
                                                    formattedResponsePart = {
                                                        functionResponse: {
                                                            name: "use_mcp_tool",
                                                            response: { content: { error: `Tool execution failed: ${error.message}` } },
                                                        },
                                                    };
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    console.warn(`Received call for unhandled tool: ${requestedToolName}`);
                                    enqueue('log', { message: `Warning: Received call for unhandled tool: ${requestedToolName}` });
                                    formattedResponsePart = {
                                        functionResponse: {
                                            name: "use_mcp_tool",
                                            response: { content: { error: `Tool '${requestedToolName}' is not implemented or recognized.` } },
                                        },
                                    };
                                }
                                toolResponses.push(formattedResponsePart);
                            } // End loop over functionCalls in this chunk
                        } // End if functionCalls.length > 0

                        // --- Text Chunk Handling ---
                        const textParts = response.candidates?.[0]?.content?.parts?.filter((part: Part) => !!part.text) ?? [];
                        const chunkText = textParts.map((part: Part) => part.text).join("");

                        if (chunkText) {
                            accumulatedText += chunkText;
                            enqueue('llm_chunk', { text: chunkText }); // Stream the chunk
                        }

                    } // End for await...of loop for stream chunks

                    // --- After processing the entire stream for this turn ---
                    if (functionCallDetected) {
                        // If function calls happened, prepare for the next loop iteration
                        currentPrompt = toolResponses; // Send responses back to Gemini
                        continue; // Go to the next loop iteration
                    } else {
                        // If no function calls, this turn resulted in text (or an error handled above)
                        if (accumulatedText) {
                            console.log("Final Gemini Text Response (from stream):", accumulatedText);
                            // No need to enqueue 'final' separately if chunks were sent
                            // enqueue('final', { text: accumulatedText }); // Optional: Send a final complete message if needed
                            controller.close(); // Close the stream after final text
                            return;
                        } else {
                            // Handle cases where the stream ended without text or function calls
                            console.warn(`Gemini stream (Turn ${i + 1}) ended without text or function calls.`);
                            // Check finishReason if available (might need to access last response chunk)
                            // For simplicity, assume an error if nothing was produced
                            enqueue('error', { message: 'LLM stream ended unexpectedly without generating text or calling functions.' });
                            controller.close();
                            return;
                        }
                    } // End of function call vs text response handling for the turn

                } // End of conversation loop (for)

                // --- Fallback if loop completes without returning ---
                console.warn("Conversation loop completed maximum iterations without returning a final response.");
                if (safetyAlert) {
                    enqueue('error', { message: "I cannot provide a response due to safety concerns encountered earlier." });
                } else {
                    enqueue('error', { message: 'Agent reached maximum interaction depth without a final response' });
                }
                controller.close();

            } catch (error) { // Catch errors from request parsing, setup, or unexpected issues
                console.error('Error processing chat stream request:', error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                // Try to enqueue error before closing
                try {
                    enqueue('error', { message: `Failed to process chat request: ${errorMessage}` });
                } catch (enqueueError) {
                    console.error("Failed to enqueue final error message:", enqueueError);
                }
                controller.close();
            }
        } // End of stream.start
    }); // End of new ReadableStream

    // Return the stream response
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}