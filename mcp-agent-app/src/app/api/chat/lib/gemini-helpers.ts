import { Content, Part, Tool, Type } from '@google/genai';
import { Message, McpConfig } from './types'; // Import shared types

// Base system prompt - will be augmented dynamically
const baseSystemPrompt = `You are a helpful and informative assistant. You can answer questions, generate creative text formats, and provide information on a wide range of topics.
You have access to external tools via connected MCP (Model Context Protocol) servers. To use these tools, call the 'use_mcp_tool' function.`;

// Helper function to map app's message format to Gemini's Content format.
export const mapMessagesToGemini = (messages: Message[]): Content[] => {
    return messages.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }],
    }));
};

// --- Intent Detection ---
export function detectRelevantServers(prompt: string, config: McpConfig): string[] {
    const relevantIds: string[] = [];
    const lowerCasePrompt = prompt.toLowerCase();

    // --- Keyword-based Server Detection ---

    // Keywords for WhatsApp
    const whatsappKeywords = ["whatsapp", "message", "chat"];
    if (whatsappKeywords.some(keyword => lowerCasePrompt.includes(keyword))) {
        if (config.servers.some(s => s.id === 'whatsapp')) {
            if (!relevantIds.includes('whatsapp')) { // Avoid duplicates
                relevantIds.push('whatsapp');
            }
        }
    }

    // Keywords for GitHub
    const githubKeywords = ["github", "issue", "repo", "repository", "pull request", "pr", "code"];
    if (githubKeywords.some(keyword => lowerCasePrompt.includes(keyword))) {
        if (config.servers.some(s => s.id === 'github')) {
            if (!relevantIds.includes('github')) { // Avoid duplicates
                relevantIds.push('github');
            }
        }
    }

    // Keywords for GSuite (Gmail, Calendar, etc.)
    const gsuiteKeywords = ["gsuite", "gmail", "mail", "email", "calendar", "event", "schedule", "meeting"];
    if (gsuiteKeywords.some(keyword => lowerCasePrompt.includes(keyword))) {
        // Check if a server with id 'gsuite' actually exists in config
        if (config.servers.some(s => s.id === 'gsuite')) {
            // Avoid duplicates
            if (!relevantIds.includes('gsuite')) {
                relevantIds.push('gsuite');
            }
        }
    }

    console.log(`Detected relevant servers for prompt: ${relevantIds.join(', ')}`);
    return relevantIds;
}
// --- End Intent Detection ---

// Helper function to generate the dynamic system prompt based on MCP config
export function generateSystemPrompt(config: McpConfig, relevantServerIds: string[]): string {
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
export const tools: Tool[] = [{
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
export const formatToolResultForGemini = (toolName: string, result: any): Part => {
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