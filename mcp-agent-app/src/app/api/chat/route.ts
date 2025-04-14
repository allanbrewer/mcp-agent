import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
// Use types from the new SDK import
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Content, Part, FunctionDeclaration, Tool, FunctionCallingConfigMode, Type } from '@google/genai'; // Revert back to GoogleGenAI class name

// Define the structure for a message
interface Message {
    sender: 'user' | 'llm';
    text: string;
}

// Define the structure for the incoming request body
interface RequestBody {
    messages: Message[];
}

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' }); // Ensure .env.local is loaded if needed server-side

const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
    throw new Error("GOOGLE_API_KEY environment variable not set");
}

const genAI = new GoogleGenAI({ apiKey: API_KEY }); // Correct instantiation
const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048,
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// System prompt definition
const systemPrompt = `You are a helpful and informative assistant. You can answer questions, generate creative text formats, and provide information on a wide range of topics. You also have access to external tools that allow you to interact with other services, such as messaging apps, email, GitHub, etc. Use these tools when appropriate to fulfill the user's request, but answer general knowledge questions directly if no tool is needed.`;

// Helper function to map app's message format to Gemini's format, ensuring 'user' follows system prompt if user messages exist.
// Helper function to map app's message format to Gemini's Content format.
// Does NOT add the system prompt here.
const mapMessagesToGemini = (messages: Message[]): Content[] => {
    return messages.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }],
    }));
};

// Define the tool(s) for Gemini Function Calling
// Note: SchemaType might be inferred or use a different enum in @google/genai
// Keeping explicit types for now, adjust if TS errors occur.
const functionDeclarationsTool: Tool = {
    functionDeclarations: [
        {
            name: "send_message", // Keep consistent naming if WhatsApp server expects this
            description: "Sends a message to a specified WhatsApp contact or group.",
            parameters: {
                type: Type.OBJECT, // Use Type enum
                properties: {
                    recipient: { type: Type.STRING, description: "The phone number (with country code) or group JID to send the message to." },
                    message: { type: Type.STRING, description: "The text message content to send." },
                },
                required: ["recipient", "message"],
            },
        },
        {
            name: "list_chats",
            description: "Lists the available WhatsApp chats, optionally filtering by name.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: { type: Type.STRING, description: "Optional search term to filter chats by name or JID" },
                    limit: { type: Type.NUMBER, description: "Maximum number of chats to return (default 20)" },
                    page: { type: Type.NUMBER, description: "Page number for pagination (default 0)" },
                    include_last_message: { type: Type.BOOLEAN, description: "Whether to include the last message in each chat (default True)" },
                    sort_by: { type: Type.STRING, description: 'Field to sort results by, either "last_active" or "name" (default "last_active")' }
                },
                required: [],
            },
        },
        {
            name: "search_contacts",
            description: "Searches for WhatsApp contacts by name or phone number.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: { type: Type.STRING, description: "Search term to match against contact names or phone numbers" },
                    // limit is not a parameter in the python function
                },
                required: ["query"],
            },
        },
        {
            name: "list_messages",
            description: "Retrieves messages with optional filters and context.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    after: { type: Type.STRING, description: "Optional ISO-8601 formatted string to only return messages after this date" },
                    before: { type: Type.STRING, description: "Optional ISO-8601 formatted string to only return messages before this date" },
                    sender_phone_number: { type: Type.STRING, description: "Optional phone number to filter messages by sender" },
                    chat_jid: { type: Type.STRING, description: "Optional chat JID to filter messages by chat" },
                    query: { type: Type.STRING, description: "Optional search term to filter messages by content" },
                    limit: { type: Type.NUMBER, description: "Maximum number of messages to return (default 20)" },
                    page: { type: Type.NUMBER, description: "Page number for pagination (default 0)" },
                    include_context: { type: Type.BOOLEAN, description: "Whether to include messages before and after matches (default True)" },
                    context_before: { type: Type.NUMBER, description: "Number of messages to include before each match (default 1)" },
                    context_after: { type: Type.NUMBER, description: "Number of messages to include after each match (default 1)" }
                },
                required: [], // All parameters are optional in main.py
            },
        },
        {
            name: "get_chat",
            description: "Get information about a specific chat.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    chat_jid: { type: Type.STRING, description: "The JID of the chat to retrieve" },
                    include_last_message: { type: Type.BOOLEAN, description: "Whether to include the last message (default True)" }
                },
                required: ["chat_jid"],
            },
        },
        {
            name: "get_direct_chat_by_contact",
            description: "Find a direct chat with a specific contact.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    sender_phone_number: { type: Type.STRING, description: "The phone number to search for" },
                },
                required: ["sender_phone_number"],
            },
        },
        {
            name: "get_contact_chats",
            description: "List all chats involving a specific contact.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    jid: { type: Type.STRING, description: "The contact's JID to search for" },
                    limit: { type: Type.NUMBER, description: "Maximum number of chats to return (default 20)" },
                    page: { type: Type.NUMBER, description: "Page number for pagination (default 0)" }
                },
                required: ["jid"],
            },
        },
        {
            name: "get_last_interaction",
            description: "Get the most recent message with a contact.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    jid: { type: Type.STRING, description: "The JID of the contact." }, // Changed from contact_jid
                },
                required: ["jid"], // Changed from contact_jid
            },
        },
        {
            name: "get_message_context",
            description: "Retrieve context around a specific message.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    message_id: { type: Type.STRING, description: "The ID of the message to get context for" },
                    before: { type: Type.NUMBER, description: "Number of messages to include before the target message (default 5)" },
                    after: { type: Type.NUMBER, description: "Number of messages to include after the target message (default 5)" }
                    // chat_jid is not a parameter in main.py
                },
                required: ["message_id"],
            },
        },
        {
            name: "send_file",
            description: "Send a file (image, video, raw audio, document) to a specified recipient.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    recipient: { type: Type.STRING, description: "The recipient phone number (no symbols) or JID." },
                    media_path: { type: Type.STRING, description: "The absolute path to the media file to send (image, video, document)" },
                    // caption is not a parameter in main.py
                },
                required: ["recipient", "media_path"],
            },
        },
        {
            name: "send_audio_message",
            description: "Send an audio file as a WhatsApp voice message (requires the file to be an .ogg opus file or ffmpeg must be installed).",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    recipient: { type: Type.STRING, description: "The recipient phone number (no symbols) or JID." },
                    media_path: { type: Type.STRING, description: "The absolute path to the audio file to send (will be converted to Opus .ogg if needed)" },
                },
                required: ["recipient", "media_path"],
            },
        },
        {
            name: "download_media",
            description: "Download media from a WhatsApp message and get the local file path.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    message_id: { type: Type.STRING, description: "The ID of the message containing the media." },
                    chat_jid: { type: Type.STRING, description: "The JID of the chat the message belongs to." },
                },
                required: ["message_id", "chat_jid"],
            },
        },
        // Add other tools here later
    ]
};
// Define the Google Search tool
const googleSearchTool: Tool = {
    googleSearch: {}, // Enable Google Search tool
};
// Use only function declarations due to incompatibility with googleSearch
const tools: Tool[] = [functionDeclarationsTool];

/**
 * Calls an MCP tool via a spawned stdio process.
 * Handles initialization handshake and tool execution.
 */
async function callMcpToolViaSpawn(toolName: string, toolArgs: any): Promise<any> {
    console.log(`Attempting MCP tool call via spawn: ${toolName}`);
    // Determine command based on tool name - Basic example
    let command: string;
    let args: string[];
    // scriptDir will be determined within the tool-specific logic

    // Define WhatsApp-related tools that use the same script
    const whatsappTools = ['send_message', 'list_chats', 'search_contacts', 'list_messages', 'get_chat', 'get_direct_chat_by_contact', 'get_contact_chats', 'get_last_interaction', 'get_message_context', 'send_file', 'send_audio_message', 'download_media'];


    if (whatsappTools.includes(toolName)) { // Handle all WhatsApp tools via uv
        const uvPath = process.env.UV_PATH || 'uv'; // Get UV path or default to 'uv'
        const whatsappScriptDir = process.env.WHATSAPP_MCP_SCRIPT_DIR; // Get WhatsApp script dir

        if (!whatsappScriptDir) {
            console.error("WHATSAPP_MCP_SCRIPT_DIR environment variable is not set. This is required for the 'send_message' tool.");
            throw new Error("Configuration Error: WHATSAPP_MCP_SCRIPT_DIR environment variable is not set.");
        }

        command = uvPath;
        // Use the retrieved environment variable for the directory
        args = ['run', '--directory', whatsappScriptDir, 'main.py'];
    }
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

        // 1. Map application messages to Gemini format
        const mappedMessages = mapMessagesToGemini(messages);

        if (mappedMessages.length === 0) {
            return NextResponse.json({ error: 'Cannot start chat with empty mapped messages' }, { status: 400 });
        }

        // 2. Separate the latest message (for sendMessage) from the preceding history (for startChat)
        const latestMessage = mappedMessages[mappedMessages.length - 1];
        let chatHistoryForStart = mappedMessages.slice(0, -1);

        // 3. Prepare history for startChat: MUST start with 'user' or be empty.
        //    Do NOT include the system prompt in this array.
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

        // 4. Define the system instruction separately using the 'model' role as required by Content type
        const systemInstruction: Content = { role: 'model', parts: [{ text: systemPrompt }] };

        // 5. Start chat session using genAI.chats.create
        const chat = genAI.chats.create({
            model: "gemini-2.0-flash-001", // Specify model name here
            history: chatHistoryForStart, // History strictly starts with 'user' or is empty
            config: { // Pass other configs within the 'config' object
                ...generationConfig, // Spread generationConfig properties directly
                safetySettings,
                tools: tools, // Pass combined tools array
                systemInstruction: systemInstruction, // Pass system prompt here
                // toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } // Optional: Explicitly set tool config if needed
            }
        });

        // --- Start Conversation Loop ---
        // The first prompt sent to Gemini is the content of the latest message.
        let currentPrompt: string | Part[] = latestMessage.parts ?? []; // Add fallback for potentially undefined parts
        let safetyAlert = false;
        let finalApiResponse: NextResponse | null = null; // To store the final response

        for (let i = 0; i < 5; i++) { // Limit loops
            console.log(`--- Loop ${i + 1}: Sending to Gemini ---`);
            // Use sendMessage with a parameters object
            const result = await chat.sendMessage({ message: currentPrompt });
            // Access response data directly from the result object
            const response = result; // Use the result object directly

            // DEBUG: Log the raw response structure to understand the new SDK's format
            console.log(`DEBUG: Raw Gemini Response (Loop ${i + 1}):`, JSON.stringify(response, null, 2));

            // Check if candidates exist (response structure might vary on error)
            if (!response.candidates || response.candidates.length === 0) {
                console.error('Gemini API response missing candidates:', response);
                // Check for prompt feedback block reason
                if (response.promptFeedback?.blockReason) {
                    console.warn(`Prompt blocked due to ${response.promptFeedback.blockReason}`);
                    safetyAlert = true; // Treat prompt blocking as a safety alert
                    // Return appropriate response immediately
                    return NextResponse.json({ reply: { sender: 'llm', text: `Prompt blocked due to ${response.promptFeedback.blockReason}` } }, { status: 200 });
                }
                finalApiResponse = NextResponse.json({ error: 'LLM returned no candidates or unexpected response structure' }, { status: 500 });
                // Return appropriate response immediately
                return finalApiResponse;
            }

            // Check safety ratings
            if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
                console.warn("Gemini response blocked due to safety settings.");
                safetyAlert = true;
                // Return appropriate response immediately
                return NextResponse.json({ reply: { sender: 'llm', text: "Response blocked by safety settings." } }, { status: 200 });
            }

            // --- Extract Function Calls (Adjust based on new SDK structure) ---
            // Assuming function calls are now within response.candidates[0].content.parts
            const functionCallParts = response.candidates?.[0]?.content?.parts?.filter((part: Part) => !!part.functionCall) ?? []; // Add Part type
            const functionCalls = functionCallParts.map((part: Part) => part.functionCall).filter((fc: Part['functionCall'] | undefined): fc is NonNullable<Part['functionCall']> => !!fc); // Added explicit type to fc and used NonNullable

            if (functionCalls && functionCalls.length > 0) { // Check if the extracted array has calls
                // --- Handle Function Call ---
                console.log("DEBUG: Detected function call(s):", JSON.stringify(functionCalls, null, 2));
                const functionCall = functionCalls[0]; // Handle first call
                const toolName = functionCall.name;
                const toolArgs = functionCall.args;
                let toolExecutionResult: any;

                if (!toolName) {
                    console.error("Function call received without a name:", JSON.stringify(functionCall, null, 2));
                    currentPrompt = [{ functionResponse: { name: "unknown_tool", response: { error: "Function call received without a tool name." } } }];
                    continue; // Send error back to Gemini in next loop iteration
                }

                try {
                    console.log(`Executing tool '${toolName}' with args:`, toolArgs);
                    toolExecutionResult = await callMcpToolViaSpawn(toolName, toolArgs);
                    console.log(`DEBUG: Tool '${toolName}' executed successfully. Result:`, toolExecutionResult);
                    currentPrompt = [{ functionResponse: { name: toolName, response: toolExecutionResult } }];
                    continue; // Explicitly continue to next iteration
                } catch (error: any) {
                    console.error(`Error executing tool '${toolName}' via spawn:`, error);
                    currentPrompt = [{ functionResponse: { name: toolName, response: { error: `Failed to execute tool: ${error.message}` } } }];
                    continue; // Explicitly continue to next iteration even on error
                }
                // Continue loop to send function response back to Gemini

            } else {
                // --- Handle Text Response ---
                const textParts = response.candidates?.[0]?.content?.parts?.filter((part: Part) => !!part.text) ?? [];
                const replyText = textParts.map((part: Part) => part.text).join("");

                if (replyText) {
                    console.log("DEBUG: Final Gemini Text Response:", replyText);
                    const finalReply: Message = { sender: 'llm', text: replyText };
                    finalApiResponse = NextResponse.json({ reply: finalReply }, { status: 200 });
                    // Return the successful text response immediately
                    return finalApiResponse;
                } else {
                    // --- Handle No Text and No Function Call ---
                    console.warn(`Gemini response (Loop ${i + 1}) had no text or function calls.`);
                    const finishReason = response.candidates?.[0]?.finishReason;
                    if (finishReason && finishReason !== 'STOP') { // Check if finishReason indicates an issue (anything other than STOP)
                        console.error(`Gemini response finished unexpectedly: ${finishReason}`);
                        finalApiResponse = NextResponse.json({ error: `LLM response finished unexpectedly: ${finishReason}` }, { status: 500 });
                    } else {
                        // This might happen if the model just stops without output after a tool call, or has nothing more to say.
                        console.error('LLM returned empty or unexpected response structure:', response);
                        finalApiResponse = NextResponse.json({ error: 'LLM returned empty or unexpected response.' }, { status: 500 });
                    }
                    // Return the error response immediately
                    return finalApiResponse;
                }
            }

            console.log("DEBUG: Exited loop. Checking final response conditions..."); // ADDED LOG
            // Return the final response determined in the loop
            if (finalApiResponse) {
                console.log("DEBUG: Returning finalApiResponse set within loop."); // ADDED LOG
                return finalApiResponse;
            }

            // Handle cases where loop finished without a definitive response
            if (safetyAlert) {
                console.log("DEBUG: Returning safety alert response."); // ADDED LOG
                return NextResponse.json({ reply: { sender: 'llm', text: "I cannot provide a response due to safety concerns." } }, { status: 200 });
            } else {
                // Max iterations reached
                console.error("Maximum tool call loops reached without final text response.");
                console.log("DEBUG: Returning max iterations/unexpected exit response."); // ADDED LOG
                return NextResponse.json({ error: 'Agent reached maximum interaction depth' }, { status: 500 });
            }

        }
    } catch (error) {
        console.error('Error processing chat request:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return NextResponse.json({ error: `Failed to process chat request: ${errorMessage}` }, { status: 500 });
    }
}