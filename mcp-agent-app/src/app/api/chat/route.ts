import { spawn } from 'child_process'; // Added
import { randomUUID } from 'crypto'; // Added
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
    // Get all messages except the last one for history
    const historyMessages = messages.slice(0, -1);

    // Map to Gemini format
    let mappedHistory = historyMessages.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }],
    }));

    // Find the index of the first 'user' message
    const firstUserIndex = mappedHistory.findIndex(msg => msg.role === 'user');

    // If no 'user' message is found or history is empty, return empty array
    // Gemini API requires history to start with 'user' if not empty.
    if (firstUserIndex === -1) {
        return [];
    }

    // Slice the array starting from the first 'user' message
    // This ensures the history starts with 'user' role.
    mappedHistory = mappedHistory.slice(firstUserIndex);

    return mappedHistory;
};

// Define the tool(s) for Gemini Function Calling, explicitly typed
const tools: Tool[] = [{
    functionDeclarations: [
        {
            name: "send_message",
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
    ]
}];

/**
 * Calls an MCP tool via a spawned stdio process.
 * Handles initialization handshake and tool execution.
 */
async function callMcpToolViaSpawn(toolName: string, toolArgs: any): Promise<any> {
    console.log(`Attempting MCP tool call via spawn: ${toolName}`);
    const uvPath = process.env.UV_PATH || 'uv';
    const scriptDir = '/Users/abrewer/projects/mcp-agent/whatsapp-mcp/whatsapp-mcp-server'; // TODO: Make configurable?
    const command = uvPath;
    const args = ['run', '--directory', scriptDir, 'main.py'];

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
            mcpProcess.stdout.removeAllListeners();
            mcpProcess.stderr.removeAllListeners();
            mcpProcess.removeAllListeners();
        };

        const processLine = (line: string) => {
            if (!line || toolCallResponseReceived) return; // Ignore empty lines or if already done
            try {
                const parsedResponse = JSON.parse(line);
                // console.log("Parsed MCP Response:", JSON.stringify(parsedResponse, null, 2)); // Keep this commented unless deep debugging

                // Check if it's the initialize response
                if (!initializeResponseReceived && parsedResponse.id === initializeRequestId && parsedResponse.result?.capabilities) {
                    console.log("MCP Initialization successful.");
                    initializeResponseReceived = true;
                    isInitialized = true;

                    // --- Send Initialized Notification ---
                    const initializedNotification = {
                        jsonrpc: "2.0",
                        method: "notifications/initialized",
                        params: {}
                    };
                    const initializedString = JSON.stringify(initializedNotification) + '\n';
                    console.log("Sending MCP Initialized Notification.");
                    if (!mcpProcess.stdin.writableEnded) {
                        mcpProcess.stdin.write(initializedString);
                    } else {
                        console.error("MCP stdin closed before sending initialized notification.");
                        if (!toolCallResponseReceived) reject(new Error("MCP stdin closed prematurely (initialized notification)."));
                        cleanup();
                        return;
                    }

                    // --- Introduce Delay before sending Tool Call Request ---
                    console.log("Waiting 100ms before sending tool call...");
                    setTimeout(() => {
                        if (!isInitialized || !mcpProcess || mcpProcess.killed || mcpProcess.stdin.writableEnded) {
                            console.error("MCP state invalid or process closed before sending tool call.");
                            if (!toolCallResponseReceived) reject(new Error("MCP state invalid or process closed before tool call."));
                            cleanup();
                            return;
                        }
                        toolCallRequestId = randomUUID();
                        const toolCallRequest = {
                            jsonrpc: "2.0",
                            method: "tools/call",
                            params: { name: toolName, arguments: toolArgs }, // Use function parameters
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
                        resolve(parsedResponse.result); // Resolve the main promise
                    }
                    cleanup(); // Clean up timeout and listeners once resolved/rejected

                } else {
                    // Ignore other messages for now (like potential notifications) unless debugging
                    // console.warn("Received unexpected or already processed MCP message:", line);
                }
            } catch (parseError: any) {
                console.error(`Failed to parse MCP JSON: ${line}. Error: ${parseError.message}`);
                // Don't reject immediately on parse error, might be non-JSON output before the actual response
            }
        };

        mcpProcess.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            // console.log(`MCP Server stdout chunk: ${data}`); // Keep commented unless debugging chunks
            let newlineIndex;
            while ((newlineIndex = stdoutBuffer.indexOf('\n')) >= 0) {
                const line = stdoutBuffer.substring(0, newlineIndex).trim();
                stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);
                processLine(line);
            }
        });

        mcpProcess.stderr.on('data', (data) => {
            errorData += data.toString();
            console.error(`MCP Server stderr: ${data}`); // Always log stderr
        });

        mcpProcess.on('error', (err) => {
            console.error(`MCP Spawn error: ${err.message}`);
            if (!toolCallResponseReceived) reject(new Error(`Spawn error: ${err.message}`));
            cleanup();
        });

        mcpProcess.on('close', (code) => {
            console.log(`MCP process exited with code ${code}`);
            if (!toolCallResponseReceived) { // If we haven't successfully gotten a response
                // Process remaining buffer data
                if (stdoutBuffer.trim()) {
                    console.log("Processing remaining stdout buffer on close...");
                    stdoutBuffer.split('\n').forEach(processLine);
                }
                // If still no response after processing buffer, reject
                if (!toolCallResponseReceived) {
                    reject(new Error(`MCP process exited with code ${code} before completing tool call. Stderr: ${errorData || 'None'}`));
                }
            }
            cleanup(); // Final cleanup
        });

        // --- Send Initialize Request ---
        initializeRequestId = randomUUID();
        const initializeRequest = {
            jsonrpc: "2.0",
            method: "initialize",
            params: {
                protocolVersion: "1.0",
                clientInfo: { name: "mcp-agent-nextjs-client", version: "0.1.0" },
                capabilities: {}
            },
            id: initializeRequestId
        };
        const initializeRequestString = JSON.stringify(initializeRequest) + '\n';
        console.log("Sending MCP Initialize Request.");
        mcpProcess.stdin.write(initializeRequestString);
    });
}

export async function POST(request: Request) {
    try {
        const body: RequestBody = await request.json(); // Corrected: Use parameter 'request'
        const { messages } = body;

        if (!messages || messages.length === 0) {
            return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
        }

        // Extract the latest user message
        const latestUserMessage = messages[messages.length - 1];
        if (latestUserMessage.sender !== 'user') {
            return NextResponse.json({ error: 'Last message must be from user' }, { status: 400 });
        }
        const prompt = latestUserMessage.text;

        // Map the history for the chat session
        const history = mapMessagesToGemini(messages);

        // Start chat with tools enabled
        const chat = model.startChat({
            generationConfig,
            safetySettings,
            history: history,
            tools: tools, // Pass tools here
        });

        // Send message without tools option here
        const result = await chat.sendMessage(prompt);
        const response = result.response;

        // --- NEW LOGGING ---
        console.log("DEBUG: Full Gemini Response Object:", JSON.stringify(response, null, 2));
        // --- END NEW LOGGING ---

        if (!response) { // Check for response object itself first
            console.error('Gemini API response object is missing');
            return NextResponse.json({ error: 'Failed to get response object from LLM' }, { status: 500 });
        }

        // Check for function calls in the response
        const functionCalls = response.functionCalls(); // Use the function to get the array

        if (functionCalls && functionCalls.length > 0) {
            console.log("DEBUG: Detected function call(s):", JSON.stringify(functionCalls, null, 2));

            // --- Handle Function Call(s) ---
            // For now, we only handle the first call and don't loop back to Gemini
            const functionCall = functionCalls[0]; // Use consistent naming

            if (functionCall.name === 'send_message') { // Corrected tool name check
                // --- Call MCP Tool via Spawn ---
                try {
                    const toolResult = await callMcpToolViaSpawn(functionCall.name, functionCall.args);
                    const replyMessage: Message = {
                        sender: 'llm', // Or 'tool'
                        text: `✅ WhatsApp message sent successfully. Result:\n\`\`\`json\n${JSON.stringify(toolResult ?? { status: "ok" }, null, 2)}\n\`\`\`` // Provide default if result is null/undefined
                    };
                    console.log("Sending success reply to client:", replyMessage);
                    return NextResponse.json({ reply: replyMessage });
                } catch (error: any) {
                    console.error("Error executing tool via spawn:", error);
                    const errorMessage: Message = { sender: 'llm', text: `⚠️ Error executing WhatsApp action: ${error.message}` };
                    // Consider returning 500 for internal server errors
                    return NextResponse.json({ reply: errorMessage }, { status: 500 });
                }

            } else {
                // Handle unknown tool call
                console.warn(`Unknown tool called: ${functionCall.name}`);
                const errorMessage: Message = { sender: 'llm', text: `Unknown tool requested: ${functionCall.name}` };
                return NextResponse.json({ reply: errorMessage });
            }

        } else if (response.text) {
            // --- Handle Regular Text Response (No Function Call) ---
            const replyText = response.text();
            console.log("DEBUG: Gemini Raw Response Text (No function call detected):", replyText);
            const originalReply: Message = {
                sender: 'llm',
                text: replyText,
            };
            return NextResponse.json({ reply: originalReply }, { status: 200 });
        } else {
            // Handle cases where there's no function call and no text (should be rare but possible)
            console.error('Gemini response missing text and function calls:', response);
            return NextResponse.json({ error: 'LLM returned empty response' }, { status: 500 });
        }

    } catch (error) { // This is the catch for the main try block
        console.error('Error processing chat request:', error);
        // Provide a more specific error message if possible
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return NextResponse.json({ error: `Failed to process chat request: ${errorMessage}` }, { status: 500 });
    }
}