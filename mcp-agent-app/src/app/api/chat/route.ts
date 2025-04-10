import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Content } from '@google/generative-ai';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

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


export async function POST(request: Request) {
    // Check for GitHub PAT
    const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!githubToken) {
        console.error('Missing GitHub PAT configuration');
        return NextResponse.json({ error: 'Missing GitHub PAT configuration' }, { status: 500 });
    }

    try {
        const body: RequestBody = await request.json();
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

        const chat = model.startChat({
            generationConfig,
            safetySettings,
            history: history,
        });

        const result = await chat.sendMessage(prompt);
        const response = result.response;

        if (!response || !response.text) {
            console.error('Gemini API response missing text:', response);
            return NextResponse.json({ error: 'Failed to get valid response from LLM' }, { status: 500 });
        }

        const replyText = response.text();

        // Check for GitHub action pattern
        const githubActionRegex = /\[\[ACTION:GITHUB_GET_ISSUE owner=(.*?) repo=(.*?) issue_number=(\d+)\]\]/;
        const match = replyText.match(githubActionRegex);

        if (match) {
            const [, owner, repo, issue_number] = match;

            try {
                const mcpResult = await new Promise<Message>((resolve, reject) => {
                    const dockerArgs = ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'];
                    const dockerProcess = spawn('docker', dockerArgs, {
                        env: { ...process.env, GITHUB_PERSONAL_ACCESS_TOKEN: githubToken }
                    });

                    // Early error handling for spawn issues
                    dockerProcess.on('error', (err) => {
                        console.error(`Docker spawn error: ${err.message}`);
                        reject(new Error(`Docker spawn error: ${err.message}`));
                    });

                    // Log stderr for debugging
                    dockerProcess.stderr.on('data', (data) => {
                        console.error(`MCP Server stderr: ${data}`);
                    });

                    const mcpRequest = {
                        jsonrpc: "2.0",
                        method: "get_issue",
                        params: { owner: owner, repo: repo, issue_number: parseInt(issue_number) },
                        id: randomUUID()
                    };

                    let responseData = '';
                    dockerProcess.stdout.on('data', (chunk) => {
                        responseData += chunk.toString();
                    });

                    dockerProcess.on('close', (code) => {
                        console.log(`MCP Server process exited with code ${code}`);
                        if (code !== 0) {
                            return reject(new Error(`MCP Server process exited with code ${code}`));
                        }

                        try {
                            // Attempt to parse potentially multiple JSON objects (handle streaming if necessary)
                            // For now, assume a single JSON response object per line or concatenated
                            const lines = responseData.trim().split('\n');
                            const lastLine = lines[lines.length - 1]; // Get the last potentially complete JSON
                            if (!lastLine) {
                                throw new Error('Empty response from MCP server');
                            }
                            const parsedResponse = JSON.parse(lastLine);

                            if (parsedResponse.error) {
                                console.error('MCP Server Error:', parsedResponse.error);
                                return reject(new Error(`MCP Server Error: ${parsedResponse.error.message || 'Unknown error'}`));
                            }

                            if (parsedResponse.result) {
                                const successMessage: Message = {
                                    sender: 'llm',
                                    text: `GitHub Action Result: ${JSON.stringify(parsedResponse.result, null, 2)}` // Pretty print result
                                };
                                resolve(successMessage);
                            } else {
                                // Handle cases where there's no error but also no result (unexpected)
                                return reject(new Error('Invalid MCP server response structure'));
                            }
                        } catch (parseError) {
                            console.error('Failed to parse MCP server response:', parseError);
                            console.error('Raw MCP Response Data:', responseData); // Log raw data on parse failure
                            return reject(new Error(`Failed to parse MCP server response: ${parseError instanceof Error ? parseError.message : parseError}`));
                        }
                    });

                    // Send the request
                    try {
                        dockerProcess.stdin.write(JSON.stringify(mcpRequest) + '\n');
                        dockerProcess.stdin.end();
                    } catch (stdinError) {
                        console.error(`Error writing to Docker stdin: ${stdinError}`);
                        reject(new Error(`Error writing to Docker stdin: ${stdinError instanceof Error ? stdinError.message : stdinError}`));
                        // Ensure process is killed if stdin write fails
                        dockerProcess.kill();
                    }
                });

                // Return the successful result from the MCP interaction
                return NextResponse.json({ reply: mcpResult }, { status: 200 });

            } catch (actionError) {
                // Handle errors from the Promise (spawn, stderr, close, parse, MCP error)
                console.error('Error executing GitHub action:', actionError);
                const errorMessage: Message = {
                    sender: 'llm',
                    text: `Error executing GitHub action: ${actionError instanceof Error ? actionError.message : 'Unknown error'}`
                };
                return NextResponse.json({ reply: errorMessage }, { status: 500 }); // Use 500 for internal errors
            }

        } else {
            // No action detected, return original Gemini response
            const originalReply: Message = {
                sender: 'llm',
                text: replyText,
            };
            return NextResponse.json({ reply: originalReply }, { status: 200 });
        }

    } catch (error) {
        console.error('Error processing chat request with Gemini:', error);
        // Provide a more specific error message if possible
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return NextResponse.json({ error: `Failed to process chat request: ${errorMessage}` }, { status: 500 });
    }
}