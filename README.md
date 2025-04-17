# MCP Agent

A web-based conversational agent powered by Google Gemini that can interact with various external services via Model Context Protocol (MCP) servers.

## Overview

This project provides a chat interface where users can converse with Google Gemini. The agent can understand requests that require interaction with external tools (MCP Servers) and execute those actions.

## Architecture

The project consists of the following components:

1.  **Frontend (`mcp-agent-app/`):** A Next.js application providing a React-based chat interface accessible at `http://localhost:3000` (or a similar port).
2.  **Backend API (`mcp-agent-app/src/app/api/chat/route.ts`):** A Next.js API route that:
    *   Manages the conversation flow with the frontend.
    *   Communicates with the Google Gemini API using the `@google/genai` SDK.
    *   Loads MCP server configurations from `mcp-config.json`.
    *   Generates a dynamic system prompt including descriptions of connected servers and available tools.
    *   Defines a generic `use_mcp_tool` for Gemini Function Calling.
    *   Handles `functionCall` responses from Gemini.
    *   Executes MCP server commands using `child_process.spawn`.
    *   Communicates with the spawned process via stdio using JSON-RPC.
    *   Sends the formatted tool result back to Gemini in a conversational loop.
    *   Returns the final text response from Gemini to the frontend.
3.  **MCP Servers:** External processes (Python scripts, Docker containers) that implement the Model Context Protocol (MCP) and interact with specific external services (WhatsApp, GitHub, GSuite, etc.). The backend launches these servers using `child_process.spawn` and communicates with them via stdio/JSON-RPC.
4.  **Configuration (`mcp-agent-app/mcp-config.json`):** A central JSON file defining the available MCP servers, their launch commands, and the tools they provide. This file is used for dynamic prompting and to configure the backend's execution logic.

## Setup

**Prerequisites:**

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
*   [uv](https://astral.sh/uv) (Python package manager)
*   [Docker](https://www.docker.com/get-started/) (for the GitHub MCP server)
*   **Google Gemini API Key:** Obtainable from [Google AI Studio](https://aistudio.google.com/app/apikey). Set as `GOOGLE_API_KEY` in `.env.local`.
*   **GitHub Personal Access Token (PAT):** [Create one here](https://github.com/settings/personal-access-tokens/new) with appropriate scopes (e.g., `repo`, `read:user`) for the actions you want the agent to perform. Set as `GITHUB_PERSONAL_ACCESS_TOKEN` in `.env.local`.
*   **GSuite OAuth2 Credentials:** Follow the steps in the [GSuite MCP Server](#gsuite-mcp-server) section to create a Google Cloud project, enable the Gmail and Calendar APIs, configure the OAuth consent screen, create an OAuth client ID, and download the `.gauth.json` file.

**Installation & Configuration:**

1.  **Clone the repository:**
    ```bash
    git clone <repository_url>
    cd mcp-agent
    ```
2.  **Install Next.js app dependencies:**
    ```bash
    cd mcp-agent-app
    npm install
    # or yarn install
    ```
3.  **Configure Environment Variables:**
    *   Create a file named `.env.local` in the `mcp-agent-app/` directory.
    *   Add your API keys, tokens, and configuration paths to this file. Example:
        ```dotenv
        # .env.local
        GOOGLE_API_KEY=YOUR_GEMINI_API_KEY
        GITHUB_PERSONAL_ACCESS_TOKEN=YOUR_GITHUB_PAT
        UV_PATH=/Users/yourusername/.local/bin/uv # Only if uv is not in your PATH
        WHATSAPP_MCP_SCRIPT_DIR=/Users/yourusername/projects/mcp-agent/whatsapp-mcp/whatsapp-mcp-server
        GSUITE_MCP_SCRIPT_DIR=/Users/yourusername/projects/mcp-agent/mcp-gsuite
        GSUITE_GAUTH_FILE=/Users/yourusername/projects/mcp-agent/mcp-gsuite/.gauth.json
        GSUITE_ACCOUNTS_FILE=/Users/yourusername/projects/mcp-agent/mcp-gsuite/.accounts.json
        CREDENTIALS_DIR=/Users/yourusername/projects/mcp-agent/mcp-agent-app/gsuite-credentials
        ```
    *   Replace the placeholder values with your actual credentials and paths.

**Running the Application:**

1.  **Start the WhatsApp Go bridge:**
    ```bash
    cd whatsapp-mcp/whatsapp-bridge
    go run main.go
    ```
    Scan the QR code with your WhatsApp mobile app when prompted.
2.  **Start the GSuite MCP server:**
    ```bash
    cd mcp-gsuite
    uv run mcp-gsuite --gauth-file .gauth.json --accounts-file .accounts.json --credentials-dir gsuite-credentials
    ```
3.  **Ensure Docker Desktop is running** (for the GitHub MCP server).
4.  **Navigate to the Next.js app directory:**
    ```bash
    cd mcp-agent-app
    ```
5.  **Start the development server:**
    ```bash
    npm run dev
    # or yarn dev
    ```
6.  Open your browser and go to `http://localhost:3000`.

## Usage

*   Interact with the chat interface as you would with Gemini.
*   The agent will automatically determine when to use external tools based on your requests.

### Example Prompts:

*   `Send a WhatsApp message to [Recipient] saying "Hello from the MCP Agent!"`
*   `List my recent WhatsApp chats`
*   `Search my WhatsApp contacts for John`
*   `Get issue number 1 from the octocat/Spoon-Knife repository`
*   `What do I have on my calendar tomorrow in [Account Email Address]?`
*   `Search my Gmail for emails from [Sender Email Address]`

## Adding New MCP Servers

To add support for a new MCP server:

1.  **Create a Project Directory:** Create a new directory for the server (e.g., `mcp-server-newservice`).
2.  **Implement the MCP Server:** Develop the server using Python/FastAPI or another suitable language. Ensure it communicates via stdio/JSON-RPC and implements the required MCP handshake.
3.  **Configure OAuth2 (if needed):** If the server requires OAuth2 authentication, follow the appropriate steps to create credentials and configure the server to use them.
4.  **Define Tools:** Identify the tools offered by the server and their parameters.
5.  **Update `mcp-config.json`:** Add a new entry to the `servers` array in `mcp-config.json` with the server's ID, description, command details, and tool definitions.
6.  **Update Environment Variables:** Add any new required environment variables to `mcp-agent-app/.env.local`.
7.  **Test:** Start the new MCP server and test the integration through the chat interface.

## Current MCP Servers

### WhatsApp MCP Server

*   **Source:** `whatsapp-mcp/` (cloned from `https://github.com/lharries/whatsapp-mcp`)
*   **Execution:** Python script executed via `uv run`.
*   **Communication:** Stdio / MCP (JSON-RPC)
*   **Configuration:**
    *   `UV_PATH` (optional): Path to the `uv` executable.
    *   `WHATSAPP_MCP_SCRIPT_DIR`: Path to the `whatsapp-mcp/whatsapp-mcp-server` directory.
    *   Requires scanning a QR code with your WhatsApp mobile app to authenticate the Go bridge.

### GitHub MCP Server

*   **Source:** `github-mcp-server/` (cloned from `https://github.com/github/github-mcp-server`)
    *   **Execution:** Docker container executed via `docker run`.
*   **Communication:** Stdio / MCP (JSON-RPC)
*   **Configuration:**
    *   `GITHUB_PERSONAL_ACCESS_TOKEN`: GitHub Personal Access Token with appropriate scopes (e.g., `repo`, `read:user`).

### GSuite MCP Server

*   **Source:** `mcp-gsuite/` (cloned from `https://github.com/MarkusPfundstein/mcp-gsuite`)
*   **Execution:** Python script executed via `uv run`.
*   **Communication:** Stdio / MCP (JSON-RPC)
*   **Configuration:**
    *   `UV_PATH` (optional): Path to the `uv` executable.
    *   `GSUITE_MCP_SCRIPT_DIR`: Path to the `mcp-gsuite` directory.
    *   `GSUITE_GAUTH_FILE`: Path to the `.gauth.json` file (OAuth2 client configuration).
    *   `GSUITE_ACCOUNTS_FILE`: Path to the `.accounts.json` file (account information).
    *   `CREDENTIALS_DIR`: Path to the directory where OAuth credentials will be stored.
    *   Requires OAuth2 setup in the Google Cloud Console.

## File and Folder Structure

```
mcp-agent/ (Project Root)
├── .gitignore
├── LICENSE
├── PLAN.md (This file - outlining the project plan)
├── README.md (This file - project documentation)
├── mcp-agent-app/ (Next.js Application)
│   ├── .env.local (Environment variables)
│   ├── mcp-config.json (MCP server configuration)
│   ├── next.config.js
│   ├── package.json
│   ├── src/
│   │   ├── app/
│   │   │   └── api/chat/route.ts (Next.js API route - main backend logic)
│   │   └── components/ (React components for the chat interface)
├── whatsapp-mcp/ (WhatsApp MCP Server - cloned from GitHub)
│   ├── whatsapp-bridge/ (Go component)
│   └── whatsapp-mcp-server/ (Python component)
├── mcp-gsuite/ (GSuite MCP Server - cloned from GitHub)
│   ├── ... (Python code, configuration files)
└── github-mcp-server/ (GitHub MCP Server - cloned from GitHub)
    ├── ... (Go code, Dockerfile)
```

## Debugging

*   Check the terminal logs for both the Next.js server and the MCP servers for any errors.
*   Use the MCP Inspector (https://github.com/modelcontextprotocol/inspector) for debugging stdio communication.
*   Ensure all required environment variables are set correctly.
*   Verify that the OAuth2 credentials for GSuite are properly configured.

## License

This project is licensed under the terms of the MIT open source license. Please refer to [MIT](./LICENSE) for the full terms.
