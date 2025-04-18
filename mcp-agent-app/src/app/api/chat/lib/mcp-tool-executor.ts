import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { JSONRPCClient, JSONRPCRequest } from 'json-rpc-2.0';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { McpServerConfig } from './types'; // Import the necessary type

// Executes an MCP tool by spawning a configured process, performing initialization, and communicating via JSON-RPC over stdio.
export async function executeMcpTool(serverConfig: McpServerConfig, toolName: string, toolArgs: any): Promise<any> {
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

        } else if (serverConfig.id === 'gsuite') {
            // Use commandConfig which is already destructured
            const uvPath = process.env[commandConfig.executableEnvVar || 'UV_PATH'] || commandConfig.defaultExecutable;

            // Use optional chaining and nullish coalescing for env var names from config
            // Cast to any needed if these aren't in the base McpServerCommandConfig type
            const scriptDirEnvVar = (commandConfig as any).scriptDirEnvVar ?? '';
            const gauthFileEnvVar = (commandConfig as any).gauthFileEnvVar ?? '';
            const accountsFileEnvVar = (commandConfig as any).accountsFileEnvVar ?? '';
            const credentialsDirEnvVar = (commandConfig as any).credentialsDirEnvVar ?? '';

            // Get values, using the potentially empty env var names (process.env[''] will be undefined)
            const scriptDir = scriptDirEnvVar ? process.env[scriptDirEnvVar] : undefined;
            const gauthFile = gauthFileEnvVar ? process.env[gauthFileEnvVar] : undefined;
            const accountsFile = accountsFileEnvVar ? process.env[accountsFileEnvVar] : undefined;
            const credentialsDir = credentialsDirEnvVar ? process.env[credentialsDirEnvVar] : undefined;

            // Validate required values are present
            if (!uvPath || !scriptDir || !gauthFile || !accountsFile || !credentialsDir) {
                // Construct a more detailed error message listing potential env vars
                const checkedVars = [
                    commandConfig.executableEnvVar || 'UV_PATH',
                    scriptDirEnvVar || '(GSUITE_MCP_SCRIPT_DIR not configured)',
                    gauthFileEnvVar || '(GSUITE_GAUTH_FILE not configured)',
                    accountsFileEnvVar || '(GSUITE_ACCOUNTS_FILE not configured)',
                    credentialsDirEnvVar || '(GSUITE_CREDENTIALS_DIR not configured)'
                ].filter(v => v && !v.startsWith('(')); // Filter out placeholders for unconfigured vars

                // Include uvPath check in the error
                const errorMsg = `Missing required environment variables or executable for GSuite server (${serverConfig.id}). Check: ${checkedVars.join(', ')}`;
                console.error(errorMsg); // Log the error server-side
                return reject(new Error(errorMsg));
            }

            // Map argsTemplate, replacing placeholders with validated values
            args = commandConfig.argsTemplate.map(arg =>
                arg.replace('{GSUITE_MCP_SCRIPT_DIR}', scriptDir)
                    .replace('{GSUITE_GAUTH_FILE}', gauthFile)
                    .replace('{GSUITE_ACCOUNTS_FILE}', accountsFile)
                    .replace('{GSUITE_CREDENTIALS_DIR}', credentialsDir)
            );
            command = uvPath; // Set the command executable
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
                // Prepare the arguments, adding __user_id__ for GSuite (internal requirement)
                const finalToolArgs = { ...toolArgs };
                if (serverConfig.id === 'gsuite' && finalToolArgs.account) {
                    // The Python server expects "__user_id__" based on toolhandler.USER_ID_ARG
                    finalToolArgs.__user_id__ = finalToolArgs.account;
                }

                // --- GSuite: Auto-add single account if applicable ---
                if (serverConfig.id === 'gsuite') {
                    const accountsFileEnvVar = (serverConfig.command as any).accountsFileEnvVar;
                    const accountsFilePath = accountsFileEnvVar ? process.env[accountsFileEnvVar] : undefined;

                    if (accountsFilePath) {
                        try {
                            const accountsFileContent = await fs.readFile(accountsFilePath, 'utf-8');
                            const parsedAccounts = JSON.parse(accountsFileContent);

                            // Check if exactly one account is configured
                            if (parsedAccounts && Array.isArray(parsedAccounts.accounts) && parsedAccounts.accounts.length === 1) {
                                const singleAccountEmail = parsedAccounts.accounts[0]?.email;

                                // Check if account arg exists in finalToolArgs and add if needed
                                if (singleAccountEmail && finalToolArgs && typeof finalToolArgs === 'object' && !finalToolArgs.hasOwnProperty('account')) {
                                    console.log(`GSuite: Auto-adding single account '${singleAccountEmail}' to tool args for '${toolName}'.`);
                                    finalToolArgs.account = singleAccountEmail; // Modify finalToolArgs

                                    // Re-apply the __user_id__ logic in case 'account' was just added and wasn't already there
                                    if (!finalToolArgs.hasOwnProperty('__user_id__')) {
                                        console.log(`GSuite: Adding __user_id__ based on auto-added account.`);
                                        finalToolArgs.__user_id__ = singleAccountEmail;
                                    }
                                }
                            }
                        } catch (error: any) {
                            console.warn(`GSuite: Failed to read or parse accounts file ('${accountsFilePath}') for auto-account logic: ${error.message}`);
                            // Log warning but proceed without auto-account if file reading/parsing fails
                        }
                    } else {
                        console.warn(`GSuite: accountsFileEnvVar ('${accountsFileEnvVar}') not configured or env var not set. Cannot apply auto-account logic.`);
                    }
                }
                // --- End GSuite Logic ---

                // Manually construct the request according to MCP spec (tools/call method)
                const toolCallPayload: JSONRPCRequest = {
                    jsonrpc: '2.0',
                    method: "tools/call", // Use the generic 'tools/call' method
                    params: {             // Nest tool name and args within params
                        name: toolName,
                        arguments: finalToolArgs, // Use potentially modified args
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