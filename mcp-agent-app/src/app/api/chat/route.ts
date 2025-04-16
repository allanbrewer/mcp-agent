import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'; // Added ChildProcessWithoutNullStreams
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Content, Part, FunctionDeclaration, Tool, FunctionCallingConfigMode, Type } from '@google/genai';
import { JSONRPCClient, JSONRPCRequest } from 'json-rpc-2.0'; // Added

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

// --- Intent Detection ---
function detectRelevantServers(prompt: string, config: McpConfig): string[] {
    const relevantIds: string[] = [];
    const lowerCasePrompt = prompt.toLowerCase();

    // Simple keyword spotting
    if (lowerCasePrompt.includes("whatsapp")) {
        // Check if a server with id 'whatsapp' actually exists in config
        if (config.servers.some(s => s.id === 'whatsapp')) {
            relevantIds.push('whatsapp');
        }
    }
    if (lowerCasePrompt.includes("github") || lowerCasePrompt.includes("issue") || lowerCasePrompt.includes("repo") || lowerCasePrompt.includes("pull request") || lowerCasePrompt.includes("pr")) {
        // Check if a server with id 'github' actually exists in config
        if (config.servers.some(s => s.id === 'github')) {
            // Avoid duplicates
            if (!relevantIds.includes('github')) {
                relevantIds.push('github');
            }
        }
    }

    console.log(`Detected relevant servers for prompt: ${relevantIds.join(', ')}`);
    return relevantIds;
}
// --- End Intent Detection ---

// Helper function to generate the dynamic system prompt based on MCP config
function generateSystemPrompt(config: McpConfig, relevantServerIds: string[]): string {
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


    // Only add details about relevant servers if any were identified
    if (relevantServerIds.length > 0) {
        prompt += `\n\nRELEVANT MCP SERVERS AND SPECIFIC TOOLS (based on prompt keywords):\n`;

        const relevantServers = config.servers.filter(server => relevantServerIds.includes(server.id));

        if (relevantServers.length === 0) {
            // This case handles if keywords were detected but no matching server config exists
            prompt += "\nNo matching configured servers found for the detected keywords.";
        } else {
            relevantServers.forEach(server => {
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
            prompt += "\n\nTo use a relevant tool, call 'use_mcp_tool' with the correct 'serverName', 'toolName', and the required 'arguments' object based on the server and tool descriptions above.";
        }
    } else {
        // If no relevant servers, add a note clarifying only generic usage is described.
        prompt += "\n\nNo specific external tools seem relevant based on your prompt. You can still try using 'use_mcp_tool' if you know the server and tool name.";
    }

    return prompt; // Return the constructed prompt
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
    return new Promise(async (resolve, reject) => { // Added async
        const { command: commandConfig } = serverConfig;
        let command: string;
        let args: string[];
        const childEnv = { ...process.env }; // Start with current environment

        // --- Determine Command and Arguments based on Server ID ---
        if (serverConfig.id === 'whatsapp') {
            const uvPath = process.env[commandConfig.executableEnvVar || 'UV_PATH'] || commandConfig.defaultExecutable;
            if (!uvPath) {
                return reject(new Error(`Could not determine executable for MCP server ${serverConfig.id}. Checked env var '${commandConfig.executableEnvVar}' and default '${commandConfig.defaultExecutable}'.`));
            }
            const scriptDirEnvVar = commandConfig.scriptDirEnvVar || ''; // Default to empty string if not set
            const scriptDir = process.env[scriptDirEnvVar];
            if (scriptDirEnvVar && !scriptDir) { // Only require scriptDir if scriptDirEnvVar is specified in config
                return reject(new Error(`Environment variable '${scriptDirEnvVar}' required for MCP server ${serverConfig.id} script directory is not set.`));
            }

            command = uvPath;
            args = commandConfig.argsTemplate.map(arg => {
                if (arg === '{SCRIPT_DIR}') {
                    if (!scriptDir) {
                        // This should ideally not happen due to the check above, but safeguard anyway
                        reject(new Error(`Argument template for ${serverConfig.id} requires {SCRIPT_DIR}, but no script directory is configured or found.`));
                        return ''; // Return empty string to be filtered later
                    }
                    return scriptDir;
                }
                return arg;
            }).filter(arg => arg !== ''); // Filter out empty strings resulting from missing scriptDir

            // Check if filtering removed an essential arg
            if (commandConfig.argsTemplate.includes('{SCRIPT_DIR}') && args.length !== commandConfig.argsTemplate.length) {
                // Reject was already called inside map, but ensure promise is rejected if map didn't throw
                return reject(new Error(`Failed to substitute {SCRIPT_DIR} in args for ${serverConfig.id}.`));
            }

        } else if (serverConfig.id === 'github') {
            const githubPat = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
            if (!githubPat) {
                // Explicitly check for the required PAT for GitHub
                return reject(new Error("Missing GITHUB_PERSONAL_ACCESS_TOKEN environment variable for GitHub server."));
            }
            command = commandConfig.defaultExecutable; // Should be "docker"
            // Replace placeholder in argsTemplate with actual token
            args = commandConfig.argsTemplate.map(arg => arg.replace('{GITHUB_PAT}', githubPat));

        } else {
            return reject(new Error(`Unsupported MCP server ID: ${serverConfig.id}`));
        }

        // --- Pass Thru Environment Variables ---
        // Check and pass specified env vars from config if they exist in the current environment
        if (commandConfig.envVars) {
            for (const envVarName of commandConfig.envVars) {
                const value = process.env[envVarName];
                if (value === undefined) {
                    // Throw error if an env var listed in the config is missing
                    return reject(new Error(`Required environment variable '${envVarName}' for MCP server ${serverConfig.id} is not set.`));
                }
                childEnv[envVarName] = value; // Add it to the child process environment
            }
        }
        // --- End Environment Variable Handling ---


        console.log(`Spawning MCP process: ${command} ${args.join(' ')}`);
        // Spawn the process with determined command, args, and environment
        let childProcess: ChildProcessWithoutNullStreams; // Define type
        try {
            childProcess = spawn(command, args, {
                stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
                env: childEnv, // Use the constructed environment
            });
        } catch (spawnError: any) {
            console.error(`MCP Server (${serverConfig.id}) immediate spawn error:`, spawnError);
            return reject(new Error(`Failed to spawn MCP process '${command}': ${spawnError.message}`));
        }
        // --- End Process Spawning Logic ---

        let stdoutBuffer = ''; // Buffer for stdout data
        let stderrData = '';
        let initializationComplete = false; // Track initialization state
        let initializeRequestId: string | number | null = null; // Store the ID generated by the client
        let toolCallRequestId: string | number | null = null; // Store the ID generated by the client
        let finalResultReceived = false; // Track if the final tool result/error is processed

        // --- JSON-RPC Client Setup ---
        // The client is primarily used here to *format* and *send* the request via stdin.
        // Response handling is done separately by parsing stdout with JSONStream.
        const client = new JSONRPCClient((jsonRPCRequest: JSONRPCRequest) => {
            try {
                const requestString = JSON.stringify(jsonRPCRequest) + '\n';
                console.log(`Sending MCP Request (ID: ${jsonRPCRequest.id}) via stdin:`, requestString.trim());
                if (!childProcess.stdin.writable) {
                    console.error(`MCP Server (${serverConfig.id}) stdin is not writable.`);
                    // Reject might be too aggressive here if it happens later, maybe just log
                    // reject(new Error(`MCP Server (${serverConfig.id}) stdin is not writable.`));
                    return Promise.reject(new Error(`MCP Server (${serverConfig.id}) stdin is not writable.`));
                }
                childProcess.stdin.write(requestString);
                // Do NOT end stdin here; it might be needed for subsequent requests/notifications
                // childProcess.stdin.end(); // REMOVED - DO NOT END HERE
                return Promise.resolve(); // Indicate sending was initiated
            } catch (error: any) {
                console.error(`Failed to write to MCP process stdin: ${error.message}`);
                // Reject the promise associated with this specific request
                return Promise.reject(new Error(`Failed to write to MCP process stdin: ${error.message}`));
            }
        });
        // --- End JSON-RPC Client Setup ---

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

        // --- Manual Stdout Parsing ---
        childProcess.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            console.log(`MCP Server (${serverConfig.id}) stdout chunk:`, data.toString().trim());

            // Process buffer line by line (assuming newline-delimited JSON)
            let newlineIndex;
            while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
                const line = stdoutBuffer.substring(0, newlineIndex).trim();
                stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1); // Consume the line and newline

                if (line) { // Process non-empty lines
                    try {
                        const jsonResponse = JSON.parse(line);
                        console.log(`MCP Server (${serverConfig.id}) parsed JSON line:`, jsonResponse);

                        // Ignore responses without an ID (notifications) or malformed responses
                        if (jsonResponse?.id === undefined || jsonResponse?.id === null) {
                            console.warn(`MCP Server (${serverConfig.id}) received response without ID, ignoring line:`, line);
                            continue;
                        }

                        // Check if it's the Initialize response
                        if (jsonResponse.id === initializeRequestId && !initializationComplete) {
                            if (jsonResponse.error) {
                                console.error(`MCP Initialization failed:`, jsonResponse.error);
                                cleanup(new Error(`MCP Initialization Error (${jsonResponse.error.code || 'unknown'}): ${jsonResponse.error.message || 'Unknown error'}`));
                                return; // Stop processing on init error
                            } else {
                                console.log(`MCP Server (${serverConfig.id}) initialized successfully.`);
                                initializationComplete = true;
                                // Send the required 'initialized' notification (fire-and-forget)
                                sendInitializedNotification();
                                // NOW send the actual tool call request
                                sendToolCallRequest(); // Call the async function
                            }
                        }
                        // Check if it's the Tool Call response
                        else if (jsonResponse.id === toolCallRequestId && !finalResultReceived) {
                            finalResultReceived = true; // Mark as received
                            if (jsonResponse.error) {
                                console.error(`MCP Tool Execution failed:`, jsonResponse.error);
                                reject(new Error(`MCP Tool Error (${jsonResponse.error.code || 'unknown'}): ${jsonResponse.error.message || 'Unknown error'}`));
                            } else {
                                console.log(`MCP Tool Execution successful. Result:`, jsonResponse.result);
                                resolve(jsonResponse.result);
                            }
                            // Don't stop processing lines here, server might send more data?
                            // Though typically we expect only one response per request ID.
                        } else if (jsonResponse.id === initializeRequestId || jsonResponse.id === toolCallRequestId) {
                            console.warn(`MCP Server (${serverConfig.id}) received duplicate response for ID: ${jsonResponse.id}`);
                        } else {
                            console.warn(`MCP Server (${serverConfig.id}) received response with unknown ID: ${jsonResponse.id}`);
                        }

                    } catch (parseError) {
                        console.error(`MCP Server (${serverConfig.id}) JSON parse error for line: "${line}". Error:`, parseError);
                        // Decide how to handle parse errors - skip, error out, etc.
                        // Skipping for now, but might indicate a server issue or non-JSON output.
                    }
                }
            } // End while loop processing lines
        });
        // --- End Manual Stdout Parsing ---

        // Handle stderr data
        childProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
            console.error(`MCP Server (${serverConfig.id}) stderr:`, data.toString());
        });

        // Handle spawn errors
        childProcess.on('error', (error) => {
            console.error(`MCP Server (${serverConfig.id}) spawn error:`, error);
            cleanup(new Error(`Failed to spawn MCP process '${command}': ${error.message}`));
        });

        // Handle process exit
        childProcess.on('close', (code) => {
            console.log(`MCP Server (${serverConfig.id}) process exited with code ${code}`);
            if (!finalResultReceived) { // If exit happens before expected response
                cleanup(new Error(`MCP process exited unexpectedly with code ${code}. Stderr: ${stderrData || 'N/A'}. Stdout Buffer: ${stdoutBuffer || 'N/A'}`)); // Added stdoutBuffer back for debugging exit issues
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

        // Function to send the initialize request using JSONRPCClient
        const sendInitializeRequest = async () => { // Make async
            const params = {
                protocolVersion: '1.0', // Example version
                clientInfo: { name: 'mcp-agent-app', version: '0.1.0' },
                capabilities: {}, // Add client capabilities if any
            };
            try {
                // Manually construct the request to generate and store the ID beforehand
                const initializePayload: JSONRPCRequest = {
                    jsonrpc: '2.0',
                    method: 'initialize',
                    params: params,
                    id: randomUUID(), // Generate ID manually
                };

                // Ensure ID is valid before assigning
                if (initializePayload.id === undefined || initializePayload.id === null) {
                    throw new Error("Generated null/undefined ID for initialize request.");
                }
                initializeRequestId = initializePayload.id; // Store the ID

                console.log(`Attempting to send Initialize Request (ID: ${initializeRequestId}) to MCP Server (${serverConfig.id})`);
                // Use requestAdvanced to send the pre-constructed payload
                await client.requestAdvanced(initializePayload);
                console.log(`Initialize Request (ID: ${initializeRequestId}) sent via client transport.`);
                // Response will be handled by the jsonStream listener

            } catch (requestError: any) {
                console.error(`Failed to send MCP initialize request: ${requestError.message}`);
                cleanup(new Error(`Failed to send MCP initialize request: ${requestError.message}`));
            }
        };

        // Function to send the tool call request using JSONRPCClient (only after initialization)
        const sendToolCallRequest = async () => { // Make async
            if (!initializationComplete) {
                const errMsg = "Internal error: Tool call attempted before initialization.";
                console.error(errMsg);
                cleanup(new Error(errMsg));
                return;
            }
            try {
                // Manually construct the request according to MCP spec (tools/call method)
                const toolCallPayload: JSONRPCRequest = {
                    jsonrpc: '2.0',
                    method: "tools/call", // Use the generic 'tools/call' method
                    params: {             // Nest tool name and args within params
                        name: toolName,
                        arguments: toolArgs,
                    },
                    id: randomUUID(), // Generate ID manually
                };

                // Ensure ID is valid before assigning
                if (toolCallPayload.id === undefined || toolCallPayload.id === null) {
                    throw new Error(`Generated null/undefined ID for tool call request (${toolName}).`);
                }
                toolCallRequestId = toolCallPayload.id; // Store the ID

                console.log(`Attempting to send Tool Call Request (${toolName}, ID: ${toolCallRequestId}) to MCP Server (${serverConfig.id})`);
                // Use requestAdvanced to send the pre-constructed payload
                await client.requestAdvanced(toolCallPayload);
                console.log(`Tool Call Request (${toolName}, ID: ${toolCallRequestId}) sent via client transport.`);
                // Response will be handled by the jsonStream listener

                // Consider ending stdin after the *last* expected request is sent.
                // If the protocol guarantees the server responds and then potentially closes,
                // ending stdin might be safe here. Let's keep it open for flexibility for now.
                // childProcess.stdin.end(); // Keep stdin open

            } catch (requestError: any) {
                console.error(`Failed to send MCP tool call request (${toolName}): ${requestError.message}`);
                cleanup(new Error(`Failed to send MCP tool call request (${toolName}): ${requestError.message}`));
            }
        };

        // Start the process by sending the initialize request
        // No need to await here, the response handler will trigger the next step
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