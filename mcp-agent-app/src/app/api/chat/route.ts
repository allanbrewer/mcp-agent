import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
// Use types from the new SDK import
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Content, Part, FunctionDeclaration, Tool, FunctionCallingConfigMode, Type } from '@google/genai';

// Define the structure for a message
interface Message {
    sender: 'user' | 'llm';
    text: string;
}

// Define the structure for the incoming request body
interface RequestBody {
    messages: Message[];
}

// --- MCP Server Configuration Interfaces ---
interface McpToolParameterProperty { type: string; description?: string; }
interface McpToolParameters { type: string; properties: Record<string, McpToolParameterProperty>; required?: string[]; }
interface McpToolConfig { name: string; description: string; parameters: McpToolParameters; }
interface McpServerCommandConfig {
    executableEnvVar?: string;
    defaultExecutable: string;
    argsTemplate: string[];
    scriptDirEnvVar?: string;
    envVars?: string[]; // Optional environment variables for the child process
}
interface McpServerConfig {
    id: string;
    description: string;
    command: McpServerCommandConfig;
    tools: McpToolConfig[];
}
// Load environment variables
import dotenv from 'dotenv';
import fs from 'fs'; // Import fs for reading config file
import path from 'path'; // Import path for resolving config file path

dotenv.config({ path: '.env.local' }); // Ensure .env.local is loaded if needed server-side
const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
    throw new Error("GOOGLE_API_KEY environment variable not set");
}

const genAI = new GoogleGenAI({ apiKey: API_KEY }); // Correct instantiation

// --- Placeholder for MCP Configuration Loading ---
// TODO: Replace this with a proper configuration loading mechanism (e.g., singleton service)
let loadedMcpConfigs: McpServerConfig[] = [];
try {
    // Construct the absolute path to the config file relative to the current file
    // Go up from api/chat/route.ts -> api/ -> app/ -> src/ -> mcp-agent-app/ then down to mcp-config.json
    const configPath = path.resolve(__dirname, '../../../../../mcp-config.json');
    console.log(`Attempting to load MCP config from: ${configPath}`); // Log path
    const configFileContent = fs.readFileSync(configPath, 'utf-8');
    const configJson = JSON.parse(configFileContent);
    if (configJson && Array.isArray(configJson.servers)) {
        // Basic validation could be added here to ensure objects match McpServerConfig
        loadedMcpConfigs = configJson.servers as McpServerConfig[];
        console.log(`Successfully loaded ${loadedMcpConfigs.length} MCP server configurations.`);
    } else {
        console.error("Invalid MCP config format in mcp-config.json. Expected '{ \"servers\": [...] }'.");
    }
} catch (error) {
    console.error("Failed to load or parse mcp-config.json:", error);
    // Continue without MCP tools if config fails to load
}
// --- End Placeholder ---
const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 8192, // Increased token limit for potentially larger prompts/responses
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// Base system prompt - will be augmented dynamically
const baseSystemPrompt = `You are a helpful and informative assistant. You can answer questions, generate creative text formats, and provide information on a wide range of topics.
You have access to external tools via connected MCP (Model Context Protocol) servers. To use these tools, call the 'use_mcp_tool' function.`;

// Helper function to map app's message format to Gemini's Content format.
const mapMessagesToGemini = (messages: Message[]): Content[] => {
    return messages.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }],
    }));
};

// Define the generic MCP tool(s) for Gemini Function Calling
const genericTools: Tool[] = [{
    functionDeclarations: [
        {
            name: "use_mcp_tool",
            description: "Executes a specific tool on a connected MCP server. Use this to interact with external services like WhatsApp, GitHub, etc., based on the available servers and tools listed in the system prompt.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    serverName: { type: Type.STRING, description: "The unique ID (name) of the target MCP server (e.g., 'whatsapp-mcp')." },
                    toolName: { type: Type.STRING, description: "The name of the specific tool to execute on the server (e.g., 'send_message', 'list_chats')." },
                    arguments: {
                        type: Type.OBJECT,
                        description: "An object containing the arguments required by the specific tool being called.",
                        // Properties vary per tool, Gemini infers based on descriptions.
                    }
                },
                required: ["serverName", "toolName", "arguments"],
            },
        },
        // TODO: Add access_mcp_resource definition if needed later
        // {
        //     name: "access_mcp_resource",
        //     description: "Accesses a specific resource provided by a connected MCP server.",
        //     parameters: {
        //         type: Type.OBJECT,
        //         properties: {
        //             serverName: { type: Type.STRING, description: "The unique ID of the target MCP server." },
        //             resourceUri: { type: Type.STRING, description: "The URI of the resource to access." }
        //         },
        //         required: ["serverName", "resourceUri"],
        //     },
        // },
    ]
}];

// Helper function to format MCP tool results for Gemini
const formatToolResultForGemini = (toolName: string, result: any): Part => {
    let responseContent: object;

    if (typeof result === 'object' && result !== null) {
        // Use object results directly if they are JSON-serializable
        responseContent = result;
    } else if (result === undefined || result === null) {
        // Represent null/undefined results
        responseContent = { status: "completed", result: result };
    } else {
        // Wrap primitive results
        responseContent = { result: result };
    }

    return {
        functionResponse: {
            name: toolName, // Use the original tool name Gemini called (e.g., 'use_mcp_tool')
            response: responseContent as Record<string, unknown>,
        },
    };
};


// Executes an MCP tool by spawning a configured process and communicating via JSON-RPC over stdio.
async function executeMcpTool(serverConfig: McpServerConfig, toolName: string, toolArgs: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const { command: commandConfig } = serverConfig;

        // Determine executable path
        const executable = process.env[commandConfig.executableEnvVar || ''] || commandConfig.defaultExecutable;
        if (!executable) {
            return reject(new Error(`Could not determine executable for MCP server ${serverConfig.id}. Checked env var '${commandConfig.executableEnvVar}' and default '${commandConfig.defaultExecutable}'.`));
        }

        // Determine script directory if needed
        let scriptDir: string | undefined = undefined;
        if (commandConfig.scriptDirEnvVar) {
            scriptDir = process.env[commandConfig.scriptDirEnvVar];
            if (!scriptDir) {
                return reject(new Error(`Environment variable '${commandConfig.scriptDirEnvVar}' required for MCP server ${serverConfig.id} script directory is not set.`));
            }
        }

        // Process argument template
        const args = commandConfig.argsTemplate.map(arg => {
            if (arg === '{SCRIPT_DIR}') {
                if (!scriptDir) {
                    reject(new Error(`Argument template for ${serverConfig.id} requires {SCRIPT_DIR}, but no script directory is configured or found.`));
                    return ''; // Return empty string to satisfy map, rejection handles the error flow
                }
                return scriptDir;
            }
            return arg;
        }).filter(arg => arg !== ''); // Filter out empty strings potentially caused by rejection

        // If a rejection happened during arg processing, the promise is already rejected, so exit the function.
        if (args.length !== commandConfig.argsTemplate.length && commandConfig.argsTemplate.includes('{SCRIPT_DIR}') && !scriptDir) {
            return;
        }

        console.log(`Spawning MCP process: ${executable} ${args.join(' ')}`);

        // Prepare environment variables for the child process
        const childEnv = { ...process.env };
        if (commandConfig.envVars) {
            commandConfig.envVars.forEach(envVarName => {
                const value = process.env[envVarName];
                if (value !== undefined) {
                    childEnv[envVarName] = value;
                } else {
                    console.warn(`Optional environment variable '${envVarName}' for MCP server ${serverConfig.id} not found.`);
                }
            });
        }

        // Spawn the child process
        const childProcess = spawn(executable, args, {
            stdio: ['pipe', 'pipe', 'pipe'], // Use pipes for stdin, stdout, stderr
            env: childEnv,
        });

        // Variables to store data and state
        let stdoutData = '';
        let stderrData = '';
        let responseReceived = false; // Ensure resolve/reject is called only once

        // Handle stdout data
        childProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
            console.log(`MCP Server (${serverConfig.id}) stdout:`, data.toString());
            // Attempt to parse JSON-RPC response incrementally
            try {
                // Look for a complete JSON object ending marker '}' potentially followed by whitespace/newline
                const potentialJsonResponseMatch = stdoutData.match(/({.*?})\s*$/);
                if (potentialJsonResponseMatch && potentialJsonResponseMatch[1]) {
                    const jsonResponse = JSON.parse(potentialJsonResponseMatch[1]);
                    // Check if it's a valid JSON-RPC response (has result or error)
                    if (jsonResponse && (jsonResponse.result !== undefined || jsonResponse.error !== undefined)) {
                        if (!responseReceived) {
                            responseReceived = true; // Mark response as received
                            console.log(`MCP Server (${serverConfig.id}) parsed response:`, jsonResponse);
                            if (jsonResponse.error) {
                                reject(new Error(`MCP Tool Error (${jsonResponse.error.code || 'unknown'}): ${jsonResponse.error.message || 'Unknown error'}`));
                            } else {
                                resolve(jsonResponse.result);
                            }
                            // Optionally, kill the process if no further interaction is expected
                            // childProcess.kill();
                        }
                    }
                }
            } catch (parseError) {
                console.log(`MCP Server (${serverConfig.id}) JSON parse error on stdout chunk, waiting for more data...`);
            }
        });

        // Handle stderr data
        childProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
            console.error(`MCP Server (${serverConfig.id}) stderr:`, data.toString());
        });

        // Handle spawn errors (e.g., command not found)
        childProcess.on('error', (error) => {
            if (!responseReceived) {
                responseReceived = true;
                console.error(`MCP Server (${serverConfig.id}) spawn error:`, error);
                reject(new Error(`Failed to spawn MCP process '${executable}': ${error.message}`));
            }
        });

        // Handle process exit
        childProcess.on('close', (code) => {
            console.log(`MCP Server (${serverConfig.id}) process exited with code ${code}`);
            if (!responseReceived) { // Only act if no JSON-RPC response was successfully parsed
                responseReceived = true;
                if (code !== 0) {
                    reject(new Error(`MCP process exited with error code ${code}. Stderr: ${stderrData || 'N/A'}. Stdout: ${stdoutData || 'N/A'}`));
                } else if (stdoutData.trim() === '') {
                    console.warn(`MCP Server (${serverConfig.id}) process exited cleanly (code 0) but produced no stdout response.`);
                    resolve(null); // Resolve with null, assuming this might be valid for some tools
                } else {
                    reject(new Error(`MCP process exited cleanly (code 0), but failed to parse JSON-RPC response from stdout. Stdout: ${stdoutData}`));
                }
            }
        });

        // Prepare and send the JSON-RPC request payload
        const requestId = randomUUID();
        const requestPayload = {
            jsonrpc: '2.0',
            method: toolName,
            params: toolArgs,
            id: requestId,
        };

        try {
            const requestString = JSON.stringify(requestPayload) + '\n'; // Add newline delimiter
            console.log(`Sending to MCP Server (${serverConfig.id}) stdin:`, requestString);
            childProcess.stdin.write(requestString);
            childProcess.stdin.end(); // Close stdin to signal end of input
        } catch (writeError) {
            // Handle errors during serialization or writing to stdin
            if (!responseReceived) {
                responseReceived = true;
                const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
                reject(new Error(`Failed to serialize or write MCP request: ${errorMessage}`));
                childProcess.kill(); // Ensure the process is terminated if writing fails
            }
        }
    }); // End of Promise constructor
}
export async function POST(request: Request) {
    try {
        const body: RequestBody = await request.json();
        const { messages } = body;

        if (!messages || messages.length === 0) {
            return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
        }

        const mappedMessages = mapMessagesToGemini(messages);

        if (mappedMessages.length === 0) {
            return NextResponse.json({ error: 'Cannot start chat with empty mapped messages' }, { status: 400 });
        }

        const latestMessage = mappedMessages[mappedMessages.length - 1];
        let chatHistoryForStart = mappedMessages.slice(0, -1);

        // Prepare history for startChat: Ensure it starts with 'user' or is empty.
        if (chatHistoryForStart.length > 0 && chatHistoryForStart[0].role === 'model') {
            // If history starts with 'model', find the first 'user' message.
            const firstUserIndex = chatHistoryForStart.findIndex(msg => msg.role === 'user');
            if (firstUserIndex !== -1) {
                // Slice history to start from the first 'user' message.
                chatHistoryForStart = chatHistoryForStart.slice(firstUserIndex);
            } else {
                // If no 'user' messages found (only 'model' messages in history),
                // the history for startChat must be empty.
                chatHistoryForStart = [];
            }
        }
        // Now, chatHistoryForStart is guaranteed to be empty or start with 'user'.

        let dynamicSystemPrompt = baseSystemPrompt;
        if (loadedMcpConfigs.length > 0) {
            dynamicSystemPrompt += "\n\nAVAILABLE MCP SERVERS AND TOOLS:\n";
            loadedMcpConfigs.forEach(server => {
                dynamicSystemPrompt += `\nServer: ${server.id} (${server.description || 'No description'})\n`;
                if (server.tools && server.tools.length > 0) {
                    server.tools.forEach((tool: McpToolConfig) => {
                        dynamicSystemPrompt += `  - Tool: ${tool.name}\n    Description: ${tool.description || 'No description'}\n`;
                        // TODO: Consider adding parameter details (e.g., tool.parameters.properties) if helpful for the LLM.
                    });
                } else {
                    dynamicSystemPrompt += "  (No tools defined in configuration)\n";
                }
            });
            dynamicSystemPrompt += "\nRemember to use the 'use_mcp_tool' function with the correct 'serverName', 'toolName', and 'arguments' based on this list.";
        } else {
            dynamicSystemPrompt += "\n\nNo MCP servers are configured or loaded. External tools unavailable.";
        }

        const systemInstruction: Content = { role: 'model', parts: [{ text: dynamicSystemPrompt }] };
        console.log("Using Dynamic System Prompt:", dynamicSystemPrompt); // Log the prompt being used

        const chat = genAI.chats.create({
            model: "gemini-2.0-flash-001", // We are using the new SDK so 2.0 flash works
            history: chatHistoryForStart,
            config: {
                ...generationConfig,
                safetySettings,
                tools: genericTools,
                systemInstruction: systemInstruction,
                // toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } } // Consider ANY mode if AUTO struggles with tool calls
            }
        });

        // --- Start Conversation Loop ---
        // The first prompt sent to Gemini is the content of the latest message.
        let currentPrompt: string | Part[] = latestMessage.parts ?? [];
        let safetyAlert = false;
        let finalApiResponse: NextResponse | null = null; // To store the final response

        for (let i = 0; i < 5; i++) { // Limit conversation turns to prevent infinite loops
            console.log(`--- Loop ${i + 1}: Sending to Gemini ---`);
            const result = await chat.sendMessage({ message: currentPrompt });
            const response = result;

            // DEBUG: Log the raw response structure to understand the new SDK's format
            // console.log(`DEBUG: Raw Gemini Response (Loop ${i + 1}):`, JSON.stringify(response, null, 2));

            // Check if candidates exist (response structure might vary on error)
            if (!response.candidates || response.candidates.length === 0) {
                console.error('Gemini API response missing candidates:', response);
                // Check for prompt feedback block reason
                if (response.promptFeedback?.blockReason) {
                    console.warn(`Prompt blocked due to ${response.promptFeedback.blockReason}`);
                    safetyAlert = true; // Treat prompt blocking as a safety alert
                    return NextResponse.json({ reply: { sender: 'llm', text: `Prompt blocked due to ${response.promptFeedback.blockReason}` } }, { status: 200 });
                }
                finalApiResponse = NextResponse.json({ error: 'LLM returned no candidates or unexpected response structure' }, { status: 500 });
                return finalApiResponse; // Exit immediately
            }

            // Check safety ratings
            if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
                console.warn("Gemini response blocked due to safety settings.");
                safetyAlert = true;
                return NextResponse.json({ reply: { sender: 'llm', text: "Response blocked by safety settings." } }, { status: 200 }); // Exit immediately
            }

            // Extract function calls from the response
            const functionCallParts = response.candidates?.[0]?.content?.parts?.filter((part: Part) => !!part.functionCall) ?? [];
            const functionCalls = functionCallParts.map((part: Part) => part.functionCall).filter((fc): fc is NonNullable<Part['functionCall']> => !!fc);

            if (functionCalls && functionCalls.length > 0) { // Check if the extracted array has calls
                console.log("Function call(s) detected:", JSON.stringify(functionCalls, null, 2));
                // Process the first function call to determine the primary tool name for response formatting,
                // but iterate through all calls for execution.
                const firstFunctionCall = functionCalls[0];
                let toolExecutionResult: any;

                if (!firstFunctionCall?.name) {
                    console.error("Function call received without a name:", JSON.stringify(firstFunctionCall, null, 2));
                    // Prepare an error response part to send back to the model
                    currentPrompt = [{ functionResponse: { name: "unknown_tool", response: { error: "Function call received without a tool name." } } }];
                    continue; // Go to next loop iteration to send error back
                }

                // Process all function calls requested by the model in this turn
                const toolResponses: Part[] = [];

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
                            console.log(`Attempting to execute MCP tool: Server='${serverName}', Tool='${actualToolName}', Args=`, actualArgs);

                            const targetServerConfig = loadedMcpConfigs.find(s => s.id === serverName);

                            if (!targetServerConfig) {
                                console.error(`Configuration for server '${serverName}' not found.`);
                                formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Configuration for server '${serverName}' not found.` });
                            } else {
                                // Check if the requested tool exists in the server's config
                                const toolExists = targetServerConfig.tools.some(t => t.name === actualToolName);
                                if (!toolExists) {
                                    console.error(`Tool '${actualToolName}' not found in configuration for server '${serverName}'.`);
                                    formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Tool '${actualToolName}' is not defined for server '${serverName}'.` });
                                } else {
                                    // Ensure actualToolName is a valid string before calling
                                    if (typeof actualToolName !== 'string' || actualToolName === '') {
                                        console.error(`Invalid tool name provided for server '${serverName}':`, actualToolName);
                                        formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Invalid tool name provided.` });
                                    } else {
                                        try {
                                            const toolResult = await executeMcpTool(targetServerConfig, actualToolName, (actualArgs ?? {}) as any); // Explicit cast
                                            console.log(`executeMcpTool call successful for ${serverName}/${actualToolName}. Result:`, toolResult);
                                            formattedResponsePart = formatToolResultForGemini(requestedToolName, toolResult);
                                        } catch (error: any) {
                                            console.error(`executeMcpTool call failed for ${serverName}/${actualToolName}: ${error.message}`, error);
                                            formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Tool execution failed: ${error.message}` });
                                        }
                                    }
                                }
                            }
                        }
                    } else { // Handle non-"use_mcp_tool" calls if any are defined
                        // Handle potential non-MCP tools if any were defined in genericTools
                        console.warn(`Received call for unhandled tool: ${requestedToolName}`);
                        formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Tool '${requestedToolName}' is not implemented or recognized.` });
                    }
                    toolResponses.push(formattedResponsePart);
                }
                currentPrompt = toolResponses; // Prepare prompt for the next turn
                continue; // Continue loop to send tool responses back

            } else { // Handle case where Gemini returned a text response
                // --- Handle Text Response (No Function Call) ---
                const textParts = response.candidates?.[0]?.content?.parts?.filter((part: Part) => !!part.text) ?? [];
                const replyText = textParts.map((part: Part) => part.text).join("");

                if (replyText) { // Check if there's actual text content
                    console.log("Final Gemini Text Response:", replyText);
                    const finalReply: Message = { sender: 'llm', text: replyText };
                    finalApiResponse = NextResponse.json({ reply: finalReply }, { status: 200 });
                    return finalApiResponse; // Exit loop and return text response
                } else { // Should not happen if finishReason is STOP and no function call, but handle defensively
                    // --- Handle No Text and No Function Call --- (Should ideally not happen with STOP reason)
                    console.warn(`Gemini response (Loop ${i + 1}) had no text or function calls.`);
                    const finishReason = response.candidates?.[0]?.finishReason;
                    if (finishReason && finishReason !== 'STOP') {
                        console.error(`Gemini response finished unexpectedly: ${finishReason}`);
                        finalApiResponse = NextResponse.json({ error: `LLM response finished unexpectedly: ${finishReason}` }, { status: 500 });
                    } else {
                        // This case might occur if the model stops without output after a tool call, or has nothing more to say.
                        console.error('LLM returned empty or unexpected response structure:', response);
                        finalApiResponse = NextResponse.json({ error: 'LLM returned empty or unexpected response.' }, { status: 500 });
                    }
                    return finalApiResponse; // Exit loop and return error
                }
            }

            // Fallback responses if the loop completes without setting finalApiResponse
            if (safetyAlert) {
                return NextResponse.json({ reply: { sender: 'llm', text: "I cannot provide a response due to safety concerns." } }, { status: 200 });
            } else {
                console.error("Maximum conversation loops reached without a final text response.");
                return NextResponse.json({ error: 'Agent reached maximum interaction depth' }, { status: 500 });
            }

        }
    } catch (error) {
        console.error('Error processing chat request:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return NextResponse.json({ error: `Failed to process chat request: ${errorMessage}` }, { status: 500 });
    }
}