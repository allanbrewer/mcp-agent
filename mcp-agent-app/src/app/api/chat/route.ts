import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Content, Part, SchemaType, Tool } from '@google/generative-ai';


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
            name: "get_github_issue",
            description: "Gets the details of a specific issue from a GitHub repository.",
            parameters: { // This object itself should conform to Schema (specifically ObjectSchema)
                type: SchemaType.OBJECT,
                properties: {
                    // Each property here must also conform to Schema
                    owner: { type: SchemaType.STRING, description: "The owner or organization of the repository." },
                    repo: { type: SchemaType.STRING, description: "The name of the repository." },
                    issue_number: { type: SchemaType.NUMBER, description: "The number of the issue to retrieve." },
                },
                required: ["owner", "repo", "issue_number"],
            },
        },
        // Add other tool definitions here later if needed
    ]
}];

// Define the URL for the Python GitHub MCP server
const GITHUB_MCP_SERVER_URL = process.env.GITHUB_MCP_SERVER_URL || 'http://localhost:8001';


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
            const call = functionCalls[0]; // Process the first call
            let toolResult: any;
            let errorMessage: string | null = null;

            if (call.name === 'get_github_issue') {
                console.log(`DEBUG: Executing tool '${call.name}' with args:`, JSON.stringify(call.args));
                try {
                    const mcpResponse = await fetch(`${GITHUB_MCP_SERVER_URL}/get_issue`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(call.args), // Pass Gemini's args directly
                    });

                    if (mcpResponse.ok) {
                        toolResult = await mcpResponse.json();
                        console.log("DEBUG: MCP Server Response (Success):", toolResult);
                    } else {
                        const errorBody = await mcpResponse.text();
                        console.error(`DEBUG: MCP Server Request Failed (${mcpResponse.status}): ${errorBody}`);
                        errorMessage = `Error calling GitHub tool: ${mcpResponse.statusText} - ${errorBody}`;
                        toolResult = { error: errorMessage }; // Structure error for consistent handling
                    }
                } catch (fetchError: any) {
                    console.error('DEBUG: Fetch error calling MCP Server:', fetchError);
                    errorMessage = `Failed to connect to GitHub tool: ${fetchError.message}`;
                    toolResult = { error: errorMessage };
                }
            } else {
                console.warn(`DEBUG: Received unhandled function call: ${call.name}`);
                errorMessage = `Tool '${call.name}' is not supported.`;
                toolResult = { error: errorMessage };
            }

            // --- Return Tool Result Directly to Frontend ---
            // As per instructions, format the result/error and send it back immediately.
            const replyMessage: Message = {
                sender: 'llm',
                text: errorMessage
                    ? `Tool Execution Error (${call.name}):\n${errorMessage}`
                    : `Tool Result (${call.name}):\n\`\`\`json\n${JSON.stringify(toolResult, null, 2)}\n\`\`\``
            };
            return NextResponse.json({ reply: replyMessage });

            /*
            // --- FUTURE: Send result back to Gemini (Multi-turn) ---
            // This part is NOT implemented in this step as per instructions.
            const functionResponsePart: Part = {
                functionResponse: {
                    name: call.name,
                    response: { content: toolResult }, // Send the result object back
                },
            };
            // Send the function response back to the model
            const secondResult = await chat.sendMessage([functionResponsePart]); // Send Part array
            const finalResponse = secondResult.response;
            const finalText = finalResponse?.text();
    
            if (!finalText) {
                 console.error('Gemini did not return text after function call response');
                 return NextResponse.json({ error: 'LLM failed to provide final response after tool execution' }, { status: 500 });
            }
    
            const finalReply: Message = { sender: 'llm', text: finalText };
            return NextResponse.json({ reply: finalReply });
            // --- END FUTURE ---
            */

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