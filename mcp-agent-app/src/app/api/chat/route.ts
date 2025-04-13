import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
// Use FunctionDeclarationSchemaType from the SDK import
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Content, Part, FunctionDeclarationSchema, SchemaType, Tool } from '@google/generative-ai'; // Corrected import

// Define the structure for a message
interface Message {
    sender: 'user' | 'llm';
    text: string;
}

// Define the structure for the incoming request body
interface RequestBody {
    messages: Message[];
}

const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
    throw new Error("GOOGLE_API_KEY environment variable not set");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048,
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// Helper function to map app's message format to Gemini's format
const mapMessagesToGemini = (messages: Message[]): Content[] => {
    // Get all messages for history
    const historyMessages = messages; // Use all messages for history context

    // Map to Gemini format
    let mappedHistory = historyMessages.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }],
    }));

    // Find the index of the first 'user' message
    const firstUserIndex = mappedHistory.findIndex(msg => msg.role === 'user');

    // If no 'user' message is found or history is empty, return empty array
    if (firstUserIndex === -1 && mappedHistory.length > 0) {
        console.warn("History contains only model messages. Returning empty history for startChat.");
        return [];
    } else if (firstUserIndex > 0) {
        // Slice the array starting from the first 'user' message if it wasn't the first message
        mappedHistory = mappedHistory.slice(firstUserIndex);
    }

    return mappedHistory;
};

// Define the tool(s) for Gemini Function Calling, explicitly typed
const tools: Tool[] = [{
    functionDeclarations: [
        {
            name: "send_message", // Keep consistent naming if WhatsApp server expects this
            description: "Sends a message to a specified WhatsApp contact or group.",
            parameters: {
                type: SchemaType.OBJECT, // Use SchemaType enum
                properties: {
                    recipient: { type: SchemaType.STRING, description: "The phone number (with country code) or group JID to send the message to." },
                    message: { type: SchemaType.STRING, description: "The text message content to send." },
                },
                required: ["recipient", "message"],
            },
        },
        // Add other tools here later
    ]
}];

/**
 * Calls an MCP tool via a spawned stdio process.
 * Handles initialization handshake and tool execution.
 */
async function callMcpToolViaSpawn(toolName: string, toolArgs: any): Promise<any> {
    console.log(`Attempting MCP tool call via spawn: ${toolName}`);
    // Determine command based on tool name - Basic example
    let command: string;
    let args: string[];
    let scriptDir: string;

    if (toolName === 'send_message') { // Assuming this is the WhatsApp tool
        const uvPath = process.env.UV_PATH || 'uv';
        scriptDir = '/Users/abrewer/projects/mcp-agent/whatsapp-mcp/whatsapp-mcp-server'; // TODO: Make configurable
        command = uvPath;
        args = ['run', '--directory', scriptDir, 'main.py'];
    }
    // else if (toolName === 'get_github_issue') {
    //     // TODO: Add command/args for GitHub Docker server
    //     command = 'docker';
    //     args = ['run', '-i', '--rm', '-e', `GITHUB_PERSONAL_ACCESS_TOKEN=${process.env.GITHUB_PERSONAL_ACCESS_TOKEN}`, 'ghcr.io/github/github-mcp-server'];
    // }
    else {
        throw new Error(`Unsupported tool name for spawn execution: ${toolName}`);
    }


    return new Promise((resolve, reject) => {
        const mcpProcess = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdoutBuffer = '';
        let errorData = '';
        let isInitialized = false;
        let initializeResponseReceived = false;
        let toolCallResponseReceived = false;
        let initializeRequestId: string | null = null;
        let toolCallRequestId: string | null = null;

        // Set a timeout for the entire operation
        const operationTimeout = setTimeout(() => {
            if (!toolCallResponseReceived) {
                console.error(`MCP operation timed out after 30 seconds for tool: ${toolName}`);
                if (mcpProcess && !mcpProcess.killed) {
                    mcpProcess.kill('SIGTERM'); // Attempt graceful shutdown
                    console.log("Sent SIGTERM to MCP process due to timeout.");
                }
                reject(new Error(`MCP operation timed out for tool: ${toolName}`));
            }
        }, 30000); // 30 seconds timeout

        const cleanup = () => {
            clearTimeout(operationTimeout);
            // Ensure listeners are removed to prevent memory leaks
            if (mcpProcess && mcpProcess.stdout) mcpProcess.stdout.removeAllListeners();
            if (mcpProcess && mcpProcess.stderr) mcpProcess.stderr.removeAllListeners();
            if (mcpProcess) mcpProcess.removeAllListeners();
        };

        const processLine = (line: string) => {
            if (!line || toolCallResponseReceived) return; // Ignore empty lines or if already done
            try {
                const parsedResponse = JSON.parse(line);

                // Check if it's the initialize response
                if (!initializeResponseReceived && parsedResponse.id === initializeRequestId && parsedResponse.result?.capabilities) {
                    console.log("MCP Initialization successful.");
                    initializeResponseReceived = true;
                    isInitialized = true;

                    // --- Send Initialized Notification ---
                    const initializedNotification = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
                    const initializedString = JSON.stringify(initializedNotification) + '\n';
                    console.log("Sending MCP Initialized Notification.");
                    if (!mcpProcess.stdin.writableEnded) {
                        mcpProcess.stdin.write(initializedString);
                    } else {
                        console.error("MCP stdin closed before sending initialized notification.");
                        if (!toolCallResponseReceived) reject(new Error("MCP stdin closed prematurely (initialized notification)."));
                        cleanup(); return;
                    }

                    // --- Introduce Delay before sending Tool Call Request ---
                    console.log("Waiting 100ms before sending tool call...");
                    setTimeout(() => {
                        if (!isInitialized || !mcpProcess || mcpProcess.killed || mcpProcess.stdin.writableEnded) {
                            console.error("MCP state invalid or process closed before sending tool call.");
                            if (!toolCallResponseReceived) reject(new Error("MCP state invalid or process closed before tool call."));
                            cleanup(); return;
                        }
                        toolCallRequestId = randomUUID();
                        // Adjust method based on MCP server expectation (e.g., 'tools/call' or the tool name directly)
                        // The lharries/whatsapp-mcp server seems to expect the tool name directly as the method
                        const toolCallRequest = {
                            jsonrpc: "2.0",
                            method: "tools/call", // Standard MCP method for tool calls
                            params: {          // Parameters nested under 'params'
                                name: toolName,      // Tool name
                                arguments: toolArgs  // Tool arguments
                            },
                            id: toolCallRequestId
                        };
                        const toolCallString = JSON.stringify(toolCallRequest) + '\n';
                        console.log(`Sending MCP Tool Call Request: ${toolName}`);
                        mcpProcess.stdin.write(toolCallString);
                        mcpProcess.stdin.end(); // End stdin after sending the *last* request
                        console.log("MCP stdin ended.");

                    }, 100); // 100ms delay

                } else if (isInitialized && !toolCallResponseReceived && parsedResponse.id === toolCallRequestId) {
                    // This should be the tool call response
                    toolCallResponseReceived = true;
                    if (parsedResponse.error) {
                        console.error("MCP tool call returned an error:", JSON.stringify(parsedResponse.error, null, 2));
                        reject(new Error(`MCP Tool Call Error: ${parsedResponse.error.message || JSON.stringify(parsedResponse.error)}`));
                    } else {
                        console.log("MCP Tool Call successful.");
                        // Resolve with the *entire* result object from the MCP server
                        resolve(parsedResponse.result ?? { status: "ok", message: "Action completed successfully." });
                    }
                    cleanup();

                } else {
                    // Ignore other messages
                }
            } catch (parseError: any) {
                console.error(`Failed to parse MCP JSON: ${line}. Error: ${parseError.message}`);
            }
        };

        mcpProcess.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            let newlineIndex;
            while ((newlineIndex = stdoutBuffer.indexOf('\n')) >= 0) {
                const line = stdoutBuffer.substring(0, newlineIndex).trim();
                stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);
                processLine(line);
            }
        });

        mcpProcess.stderr.on('data', (data) => { errorData += data.toString(); console.error(`MCP Server stderr: ${data}`); });
        mcpProcess.on('error', (err) => { console.error(`MCP Spawn error: ${err.message}`); if (!toolCallResponseReceived) reject(new Error(`Spawn error: ${err.message}`)); cleanup(); });
        mcpProcess.on('close', (code) => {
            console.log(`MCP process exited with code ${code}`);
            if (!toolCallResponseReceived) {
                if (stdoutBuffer.trim()) { console.log("Processing remaining stdout buffer on close..."); stdoutBuffer.split('\n').forEach(processLine); }
                if (!toolCallResponseReceived) { reject(new Error(`MCP process exited with code ${code} before completing tool call. Stderr: ${errorData || 'None'}`)); }
            }
            cleanup();
        });

        // --- Send Initialize Request ---
        initializeRequestId = randomUUID();
        const initializeRequest = { jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "1.0", clientInfo: { name: "mcp-agent-nextjs-client", version: "0.1.0" }, capabilities: {} }, id: initializeRequestId };
        const initializeRequestString = JSON.stringify(initializeRequest) + '\n';
        console.log("Sending MCP Initialize Request.");
        mcpProcess.stdin.write(initializeRequestString);
    });
}

export async function POST(request: Request) {
    try {
        const body: RequestBody = await request.json();
        const { messages } = body;

        if (!messages || messages.length === 0) {
            return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
        }

        // Map the *entire* message history for Gemini's context
        const history = mapMessagesToGemini(messages);

        // Start chat session - history is managed internally by the chat object
        const chat = model.startChat({
            generationConfig,
            safetySettings,
            history: history.slice(0, -1), // Pass history *excluding* the latest user message
            tools: tools,
        });

        // --- Start Conversation Loop ---
        let currentPrompt: string | Part[] = [{ text: messages[messages.length - 1].text }]; // Start with the latest user message text
        let safetyAlert = false;
        let finalApiResponse: NextResponse | null = null; // To store the final response

        for (let i = 0; i < 5; i++) { // Limit loops
            console.log(`--- Loop ${i + 1}: Sending to Gemini ---`);
            const result = await chat.sendMessage(currentPrompt);
            const response = result.response;

            console.log(`DEBUG: Gemini Response (Loop ${i + 1}):`, JSON.stringify(response, null, 2));

            if (!response) {
                console.error('Gemini API response object is missing');
                finalApiResponse = NextResponse.json({ error: 'Failed to get response object from LLM' }, { status: 500 });
                break; // Exit loop
            }

            // Check safety ratings
            if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
                console.warn("Gemini response blocked due to safety settings.");
                safetyAlert = true;
                break; // Exit loop
            }

            const functionCalls = response.functionCalls();

            if (functionCalls && functionCalls.length > 0) {
                console.log("DEBUG: Detected function call(s):", JSON.stringify(functionCalls, null, 2));
                const functionCall = functionCalls[0]; // Handle first call
                const toolName = functionCall.name;
                const toolArgs = functionCall.args;
                let toolExecutionResult: any; // Renamed from toolResult to avoid conflict

                try {
                    // --- Call MCP Tool via Spawn ---
                    toolExecutionResult = await callMcpToolViaSpawn(toolName, toolArgs); // Use renamed variable
                    console.log(`DEBUG: Tool '${toolName}' executed successfully. Result:`, toolExecutionResult);
                    // --- Prepare Function Response Part for next Gemini call ---
                    currentPrompt = [{
                        functionResponse: {
                            name: toolName,
                            response: { content: toolExecutionResult }, // Pass result back
                        },
                    }];
                    // Continue the loop

                } catch (error: any) {
                    console.error(`Error executing tool '${toolName}' via spawn:`, error);
                    // Send error back to Gemini
                    currentPrompt = [{
                        functionResponse: {
                            name: toolName,
                            response: { content: { error: `Failed to execute tool: ${error.message}` } },
                        },
                    }];
                    // Continue loop, let Gemini handle the error message
                }
            } else if (response.text) {
                // --- Regular Text Response (End of Loop) ---
                const replyText = response.text();
                console.log("DEBUG: Final Gemini Text Response:", replyText);
                const finalReply: Message = { sender: 'llm', text: replyText };
                finalApiResponse = NextResponse.json({ reply: finalReply }, { status: 200 });
                break; // Exit loop
            } else {
                // Handle unexpected empty response
                console.error('Gemini response missing text and function calls:', response);
                finalApiResponse = NextResponse.json({ error: 'LLM returned empty or unexpected response' }, { status: 500 });
                break; // Exit loop
            }
        } // --- End Loop ---

        // Return the final response determined in the loop
        if (finalApiResponse) {
            return finalApiResponse;
        }

        // Handle cases where loop finished without a definitive response
        if (safetyAlert) {
            return NextResponse.json({ reply: { sender: 'llm', text: "I cannot provide a response due to safety concerns." } }, { status: 200 });
        } else {
            // Max iterations reached
            console.error("Maximum tool call loops reached without final text response.");
            return NextResponse.json({ error: 'Agent reached maximum interaction depth' }, { status: 500 });
        }

    } catch (error) {
        console.error('Error processing chat request:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return NextResponse.json({ error: `Failed to process chat request: ${errorMessage}` }, { status: 500 });
    }
}