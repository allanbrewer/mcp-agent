import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
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
// --- End MCP Server Configuration Interfaces ---

// Load environment variables
import dotenv from 'dotenv';
import fs from 'fs/promises'; // Use promises API for async operations
import path from 'path'; // Import path for resolving config file path

dotenv.config({ path: '.env.local' }); // Ensure .env.local is loaded if needed server-side

const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
    throw new Error("GOOGLE_API_KEY environment variable not set");
}

const genAI = new GoogleGenAI({ apiKey: API_KEY }); // Correct instantiation

// --- MCP Configuration Loading ---
const MCP_CONFIG_PATH = path.resolve(process.cwd(), 'mcp-config.json');

// Define the overall structure of the config file
interface McpConfig { servers: McpServerConfig[]; }
let loadedMcpConfig: McpConfig | null = null; // In-memory cache

async function loadMcpConfig(): Promise<McpConfig> {
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

// Helper function to generate the dynamic system prompt based on MCP config
function generateSystemPrompt(config: McpConfig): string {
    // Start with the base instructions
    let prompt = `${baseSystemPrompt}`; // baseSystemPrompt already includes intro to use_mcp_tool

    // Describe the generic tool structure
    prompt += `\n\nGENERIC TOOL AVAILABLE:\n`;
    prompt += `  - Name: use_mcp_tool\n`;
    prompt += `    Description: Executes a specific tool on a connected MCP server to interact with external services like WhatsApp, GitHub, etc.\n`;
    prompt += `    Parameters:\n`;
    prompt += `      - serverName (string, required): The unique ID of the target MCP server.\n`;
    prompt += `      - toolName (string, required): The name of the specific tool to execute on the server.\n`;
    prompt += `      - arguments (object, required): The arguments required by the specific tool, provided as a JSON object.\n`;


    // Add details about available servers and their specific tools
    prompt += `\nAVAILABLE MCP SERVERS AND SPECIFIC TOOLS:\n`;

    if (!config || !config.servers || config.servers.length === 0) {
        prompt += "\nNo MCP servers are configured or loaded. External tools unavailable.";
        return prompt;
    }

    config.servers.forEach(server => {
        prompt += `\nServer ID: ${server.id}\n  Description: ${server.description || 'No description provided.'}\n  Tools:\n`;
        if (server.tools && server.tools.length > 0) {
            server.tools.forEach(tool => {
                prompt += `    - Tool Name: ${tool.name}\n      Description: ${tool.description || 'No description provided.'}\n`;
                // Include parameter details in the prompt
                if (tool.parameters && tool.parameters.properties) {
                    prompt += `      Parameters:\n`;
                    Object.entries(tool.parameters.properties).forEach(([paramName, paramDetails]) => {
                        const required = tool.parameters.required?.includes(paramName) ? 'required' : 'optional';
                        prompt += `        - ${paramName} (${paramDetails.type}, ${required}): ${paramDetails.description || ''}\n`;
                    });
                } else {
                    prompt += `      (No parameters defined)\n`;
                }
            });
        } else {
            prompt += "    (No tools defined for this server in the configuration)\n";
        }
    });

    prompt += "\n\nTo use a tool, call 'use_mcp_tool' with the correct 'serverName', 'toolName', and the required 'arguments' object based on the server and tool descriptions above.";
    return prompt;
}

// Define the *single* generic MCP tool for Gemini Function Calling as per instructions
// IMPORTANT: Use Type from @google/genai, not an undefined SchemaType
const tools: Tool[] = [{
    functionDeclarations: [
        {
            name: "use_mcp_tool",
            description: "Executes a specific tool on a connected MCP server to interact with external services like WhatsApp, GitHub, etc.",
            parameters: {
                type: Type.OBJECT, // Use Type from @google/genai
                properties: {
                    serverName: { type: Type.STRING, description: "The unique ID of the target MCP server (e.g., 'whatsapp', 'github')." },
                    toolName: { type: Type.STRING, description: "The name of the specific tool to execute on the server (e.g., 'send_message', 'get_issue')." },
                    // Ensure arguments is explicitly an OBJECT type for Gemini
                    arguments: { type: Type.OBJECT, description: "The arguments required by the specific tool, provided as a JSON object." }
                },
                required: ["serverName", "toolName", "arguments"],
            },
        },
        // Note: access_mcp_resource is not included here as per instructions Step 3
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

// Executes an MCP tool by spawning a configured process, performing initialization, and communicating via JSON-RPC over stdio.
async function executeMcpTool(serverConfig: McpServerConfig, toolName: string, toolArgs: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const { command: commandConfig } = serverConfig;

        // --- Process Spawning Logic (mostly unchanged) ---
        const executable = process.env[commandConfig.executableEnvVar || ''] || commandConfig.defaultExecutable;
        if (!executable) {
            return reject(new Error(`Could not determine executable for MCP server ${serverConfig.id}. Checked env var '${commandConfig.executableEnvVar}' and default '${commandConfig.defaultExecutable}'.`));
        }
        let scriptDir: string | undefined = undefined;
        if (commandConfig.scriptDirEnvVar) {
            scriptDir = process.env[commandConfig.scriptDirEnvVar];
            if (!scriptDir) {
                return reject(new Error(`Environment variable '${commandConfig.scriptDirEnvVar}' required for MCP server ${serverConfig.id} script directory is not set.`));
            }
        }
        const args = commandConfig.argsTemplate.map(arg => {
            if (arg === '{SCRIPT_DIR}') {
                if (!scriptDir) {
                    reject(new Error(`Argument template for ${serverConfig.id} requires {SCRIPT_DIR}, but no script directory is configured or found.`));
                    return '';
                }
                return scriptDir;
            }
            return arg;
        }).filter(arg => arg !== '');
        if (args.length !== commandConfig.argsTemplate.length && commandConfig.argsTemplate.includes('{SCRIPT_DIR}') && !scriptDir) {
            return;
        }
        console.log(`Spawning MCP process: ${executable} ${args.join(' ')}`);
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
        const childProcess = spawn(executable, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: childEnv,
        });
        // --- End Process Spawning Logic ---

        let stdoutData = '';
        let stderrData = '';
        let initializationComplete = false; // Track initialization state
        let initializeRequestId: string | null = null;
        let toolCallRequestId: string | null = null;
        let finalResultReceived = false; // Track if the final tool result/error is processed

        const cleanup = (error?: Error) => {
            if (!childProcess.killed) {
                childProcess.kill();
            }
            if (error && !finalResultReceived) {
                finalResultReceived = true;
                reject(error);
            } else if (!finalResultReceived) {
                // If cleanup is called without an error and no result was received (e.g., process exited prematurely)
                finalResultReceived = true;
                reject(new Error(`MCP process interaction ended unexpectedly. Stderr: ${stderrData || 'N/A'}`));
            }
        };

        // Handle stdout data (Initialization and Tool Call Responses)
        childProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
            console.log(`MCP Server (${serverConfig.id}) stdout chunk:`, data.toString());

            // Process buffer for complete JSON objects
            while (true) {
                const startIndex = stdoutData.indexOf('{');
                if (startIndex === -1) {
                    // No start bracket found, wait for more data (or clear if only whitespace)
                    if (stdoutData.trim() === '') stdoutData = '';
                    break;
                }

                // Find the corresponding end bracket, respecting nesting
                let braceCount = 0;
                let endIndex = -1;
                let inString = false;
                let escapeNext = false;

                for (let i = startIndex; i < stdoutData.length; i++) {
                    const char = stdoutData[i];

                    if (escapeNext) {
                        escapeNext = false;
                        continue;
                    }
                    if (char === '\\') {
                        escapeNext = true;
                        continue;
                    }
                    if (char === '"') {
                        inString = !inString;
                    }
                    if (!inString) {
                        if (char === '{') {
                            braceCount++;
                        } else if (char === '}') {
                            braceCount--;
                            if (braceCount === 0) {
                                endIndex = i;
                                break; // Found the matching end bracket
                            }
                        }
                    }
                }

                if (endIndex === -1) {
                    // Incomplete JSON object in buffer, wait for more data
                    break;
                }

                // Extract the complete JSON string
                const jsonString = stdoutData.substring(startIndex, endIndex + 1);
                // Remove the processed part (including the object itself) from the buffer
                stdoutData = stdoutData.substring(endIndex + 1);

                try {
                    const jsonResponse = JSON.parse(jsonString);
                    if (!jsonResponse || (jsonResponse.result === undefined && jsonResponse.error === undefined)) {
                        console.warn(`MCP Server (${serverConfig.id}) parsed non-RPC JSON:`, jsonString);
                        continue; // Skip if not a valid RPC response structure
                    }

                    // Check if it's the Initialize response
                    if (jsonResponse.id === initializeRequestId && !initializationComplete) {
                        if (jsonResponse.error) {
                            console.error(`MCP Initialization failed:`, jsonResponse.error);
                            cleanup(new Error(`MCP Initialization Error (${jsonResponse.error.code || 'unknown'}): ${jsonResponse.error.message || 'Unknown error'}`));
                            break; // Stop processing on init error
                        } else {
                            console.log(`MCP Server (${serverConfig.id}) initialized successfully.`);
                            initializationComplete = true;
                            // Send the required 'initialized' notification
                            sendInitializedNotification();
                            // NOW send the actual tool call request
                            sendToolCallRequest();
                        }
                    }
                    // Check if it's the Tool Call response
                    else if (jsonResponse.id === toolCallRequestId && !finalResultReceived) {
                        finalResultReceived = true;
                        console.log(`MCP Server (${serverConfig.id}) parsed tool response:`, jsonResponse);
                        if (jsonResponse.error) {
                            reject(new Error(`MCP Tool Error (${jsonResponse.error.code || 'unknown'}): ${jsonResponse.error.message || 'Unknown error'}`));
                        } else {
                            resolve(jsonResponse.result);
                        }
                        // Optionally kill after receiving the tool response
                        // cleanup();
                        break; // Stop processing after getting the final tool response
                    } else {
                        console.warn(`MCP Server (${serverConfig.id}) received unexpected/duplicate response ID: ${jsonResponse.id}`);
                    }
                } catch (parseError) {
                    console.error(`MCP Server (${serverConfig.id}) JSON parse error for string: "${jsonString}". Error:`, parseError);
                    // Decide how to handle parse errors - skip, error out, etc.
                    // Skipping for now, but might indicate a server issue.
                }
            } // End while loop
        });

        // Handle stderr data
        childProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
            console.error(`MCP Server (${serverConfig.id}) stderr:`, data.toString());
        });

        // Handle spawn errors
        childProcess.on('error', (error) => {
            console.error(`MCP Server (${serverConfig.id}) spawn error:`, error);
            cleanup(new Error(`Failed to spawn MCP process '${executable}': ${error.message}`));
        });

        // Handle process exit
        childProcess.on('close', (code) => {
            console.log(`MCP Server (${serverConfig.id}) process exited with code ${code}`);
            if (!finalResultReceived) { // If exit happens before expected response
                cleanup(new Error(`MCP process exited unexpectedly with code ${code}. Stderr: ${stderrData || 'N/A'}. Stdout: ${stdoutData || 'N/A'}`));
            }
        });

        // Function to send the 'initialized' notification (fire-and-forget)
        const sendInitializedNotification = () => {
            const initializedPayload = {
                jsonrpc: '2.0',
                method: 'notifications/initialized', // Correct method name for the notification
                params: {}, // Empty params for initialized notification
            };
            try {
                const requestString = JSON.stringify(initializedPayload) + '\n';
                console.log(`Sending Initialized Notification to MCP Server (${serverConfig.id}) stdin:`, requestString);
                childProcess.stdin.write(requestString);
                // Do NOT end stdin here
            } catch (writeError) {
                // Log the error but don't necessarily kill the process, as the main flow might continue
                const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
                console.error(`Failed to serialize or write MCP initialized notification: ${errorMessage}`);
                // Consider if this should reject the promise or just warn
                // cleanup(new Error(`Failed to serialize or write MCP initialized notification: ${errorMessage}`));
            }
        };

        // Function to send the initialize request
        const sendInitializeRequest = () => {
            initializeRequestId = randomUUID();
            const initializePayload = {
                jsonrpc: '2.0',
                method: 'initialize',
                params: {
                    // Basic client info - enhance as needed
                    protocolVersion: '1.0', // Example version
                    clientInfo: { name: 'mcp-agent-app', version: '0.1.0' },
                    capabilities: {}, // Add client capabilities if any
                },
                id: initializeRequestId,
            };
            try {
                const requestString = JSON.stringify(initializePayload) + '\n';
                console.log(`Sending Initialize Request to MCP Server (${serverConfig.id}) stdin:`, requestString);
                childProcess.stdin.write(requestString);
                // Do NOT end stdin here, wait for tool call
            } catch (writeError) {
                const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
                cleanup(new Error(`Failed to serialize or write MCP initialize request: ${errorMessage}`));
            }
        };

        // Function to send the tool call request (only after initialization)
        const sendToolCallRequest = () => {
            if (!initializationComplete) {
                console.error("Attempted to send tool call before initialization was complete.");
                cleanup(new Error("Internal error: Tool call attempted before MCP initialization."));
                return;
            }
            toolCallRequestId = randomUUID();
            const toolCallPayload = {
                jsonrpc: '2.0',
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: toolArgs,
                },
                id: toolCallRequestId,
            };
            try {
                const requestString = JSON.stringify(toolCallPayload) + '\n';
                console.log(`Sending Tool Call Request to MCP Server (${serverConfig.id}) stdin:`, requestString);
                childProcess.stdin.write(requestString);
                childProcess.stdin.end(); // End stdin after the final request
            } catch (writeError) {
                const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
                cleanup(new Error(`Failed to serialize or write MCP tool call request: ${errorMessage}`));
            }
        };

        // Start the process by sending the initialize request
        sendInitializeRequest();

    }); // End of Promise constructor
}

export async function POST(request: Request) {
    try {
        const mcpConfig = await loadMcpConfig(); // Load MCP config
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
            const firstUserIndex = chatHistoryForStart.findIndex(msg => msg.role === 'user');
            if (firstUserIndex !== -1) {
                chatHistoryForStart = chatHistoryForStart.slice(firstUserIndex);
            } else {
                chatHistoryForStart = [];
            }
        }

        // Generate the dynamic system prompt using the helper function
        const dynamicSystemPrompt = generateSystemPrompt(mcpConfig);
        console.log("Using Dynamic System Prompt:", dynamicSystemPrompt); // Keep log for debugging

        // Create the system instruction object for Gemini
        const systemInstruction: Content = { role: 'system', parts: [{ text: dynamicSystemPrompt }] }; // Use 'system' role for system instructions

        const chat = genAI.chats.create({
            model: "gemini-2.0-flash-001",
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
            const result = await chat.sendMessage({ message: currentPrompt });
            const response = result; // Use the result object directly

            // console.log(`DEBUG: Raw Gemini Response (Loop ${i + 1}):`, JSON.stringify(response, null, 2));

            // --- Response Validation and Safety Checks ---
            if (!response.candidates || response.candidates.length === 0) {
                console.error('Gemini API response missing candidates:', response);
                if (response.promptFeedback?.blockReason) {
                    console.warn(`Prompt blocked due to ${response.promptFeedback.blockReason}`);
                    safetyAlert = true;
                    return NextResponse.json({ reply: { sender: 'llm', text: `Prompt blocked due to ${response.promptFeedback.blockReason}` } }, { status: 200 });
                }
                return NextResponse.json({ error: 'LLM returned no candidates or unexpected response structure' }, { status: 500 });
            }

            if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
                console.warn("Gemini response blocked due to safety settings.");
                safetyAlert = true;
                return NextResponse.json({ reply: { sender: 'llm', text: "Response blocked by safety settings." } }, { status: 200 });
            }

            // --- Function Call Handling ---
            const functionCallParts = response.candidates?.[0]?.content?.parts?.filter((part: Part) => !!part.functionCall) ?? [];
            const functionCalls = functionCallParts.map((part: Part) => part.functionCall).filter((fc): fc is NonNullable<Part['functionCall']> => !!fc);

            if (functionCalls.length > 0) {
                console.log("Function call(s) detected:", JSON.stringify(functionCalls, null, 2));
                const toolResponses: Part[] = [];

                // Process all function calls requested in this turn
                for (const functionCall of functionCalls) {
                    const requestedToolName = functionCall.name;
                    const toolArgs = functionCall.args;
                    let formattedResponsePart: Part;

                    if (!requestedToolName) {
                        console.error("Function call received without a name:", JSON.stringify(functionCall, null, 2));
                        formattedResponsePart = formatToolResultForGemini("unknown_tool", { error: "Function call received without a tool name." });
                    } else if (requestedToolName === "use_mcp_tool") {
                        // Extract MCP tool details
                        const { serverName, toolName: actualToolName, arguments: actualArgs } = toolArgs ?? {};

                        if (!serverName || !actualToolName) {
                            console.error("Missing serverName or toolName for use_mcp_tool:", toolArgs);
                            formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: "Missing required parameters: serverName and/or toolName." });
                        } else {
                            console.log(`Attempting to execute MCP tool: Server='${serverName}', Tool='${actualToolName}', Args=`, actualArgs);
                            // Find the server config using the loaded mcpConfig
                            const serverConfig = mcpConfig.servers.find(s => s.id === serverName);

                            if (!serverConfig) {
                                console.error(`MCP Server config not found for ID: ${serverName}`);
                                formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Configuration for MCP server '${serverName}' not found.` });
                            } else {
                                // Check if the specific tool exists within the found server config
                                const toolExists = serverConfig.tools.some(t => t.name === actualToolName);
                                if (!toolExists) {
                                    console.error(`Tool '${actualToolName}' not found in configuration for server '${serverName}'.`);
                                    formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Tool '${actualToolName}' is not defined for server '${serverName}'.` });
                                } else if (typeof actualToolName !== 'string' || actualToolName === '') {
                                    // Validate tool name type/value before execution
                                    console.error(`Invalid tool name provided for server '${serverName}':`, actualToolName);
                                    formattedResponsePart = formatToolResultForGemini(requestedToolName, { error: `Invalid tool name provided.` });
                                } else {
                                    // Execute the tool using the found serverConfig
                                    try {
                                        const toolResult = await executeMcpTool(serverConfig, actualToolName, (actualArgs ?? {}) as any);
                                        console.log(`executeMcpTool call successful for ${serverName}/${actualToolName}. Result:`, toolResult);
                                        // Ensure the response part uses the generic tool name 'use_mcp_tool'
                                        // and the result is wrapped correctly as per instruction #4
                                        formattedResponsePart = {
                                            functionResponse: {
                                                name: "use_mcp_tool", // Use the generic tool name
                                                response: { content: toolResult }, // Wrap result in 'content'
                                            },
                                        };
                                    } catch (error: any) {
                                        console.error(`executeMcpTool call failed for ${serverName}/${actualToolName}: ${error.message}`, error);
                                        // Ensure the error response part also uses the generic tool name
                                        // and the error is wrapped correctly
                                        formattedResponsePart = {
                                            functionResponse: {
                                                name: "use_mcp_tool", // Use the generic tool name
                                                response: { content: { error: `Tool execution failed: ${error.message}` } }, // Wrap error in 'content'
                                            },
                                        };
                                    }
                                }
                            }
                        }
                    } else {
                        // Handle other potential non-MCP tools if defined
                        console.warn(`Received call for unhandled tool: ${requestedToolName}`);
                        // Ensure unhandled tool response uses the generic tool name
                        formattedResponsePart = {
                            functionResponse: {
                                name: "use_mcp_tool", // Use the generic tool name (or the called name?) - Let's stick to generic for consistency
                                response: { content: { error: `Tool '${requestedToolName}' is not implemented or recognized.` } }, // Wrap error
                            },
                        };
                    }
                    toolResponses.push(formattedResponsePart);
                } // End loop over functionCalls

                // Prepare the prompt for the next iteration with tool responses
                // Update the prompt for the next loop iteration with the function responses
                currentPrompt = toolResponses; // This correctly sends the FunctionResponseParts back
                continue; // Go to the next loop iteration to send responses back to Gemini

            } else {
                // --- Text Response Handling ---
                const textParts = response.candidates?.[0]?.content?.parts?.filter((part: Part) => !!part.text) ?? [];
                const replyText = textParts.map((part: Part) => part.text).join("");

                if (replyText) {
                    console.log("Final Gemini Text Response:", replyText);
                    const finalReply: Message = { sender: 'llm', text: replyText };
                    return NextResponse.json({ reply: finalReply }, { status: 200 }); // Return final text response
                } else {
                    // Handle cases where there's no function call and no text, despite finishReason being STOP
                    console.warn(`Gemini response (Loop ${i + 1}) had no text or function calls, finishReason: ${response.candidates?.[0]?.finishReason}`);
                    // Check if finishReason indicates an unexpected stop
                    const finishReason = response.candidates?.[0]?.finishReason;
                    if (finishReason && finishReason !== 'STOP') {
                        console.error(`Gemini response finished unexpectedly: ${finishReason}`);
                        return NextResponse.json({ error: `LLM response finished unexpectedly: ${finishReason}` }, { status: 500 });
                    } else {
                        // Model stopped without text or function call - potentially valid but unusual
                        console.error('LLM returned empty response (no text/function call) despite STOP reason:', response);
                        return NextResponse.json({ error: 'LLM returned empty response.' }, { status: 500 });
                    }
                }
            } // End of function call vs text response handling

        } // End of conversation loop (for)

        // --- Fallback if loop completes without returning ---
        // This should ideally not be reached if logic inside the loop covers all exit conditions.
        console.warn("Conversation loop completed maximum iterations without returning a final response.");
        if (safetyAlert) {
            return NextResponse.json({ reply: { sender: 'llm', text: "I cannot provide a response due to safety concerns encountered earlier." } }, { status: 200 });
        }
        return NextResponse.json({ error: 'Agent reached maximum interaction depth without a final response' }, { status: 500 });

    } catch (error) { // Catch errors from request parsing, setup, or unexpected issues
        console.error('Error processing chat request:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return NextResponse.json({ error: `Failed to process chat request: ${errorMessage}` }, { status: 500 });
    }
}