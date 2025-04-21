# MCP Agent

A web-based conversational agent powered by various LLMs (Google Gemini, Anthropic Claude, OpenAI GPT, xAI Grok) via the Vercel AI SDK, capable of interacting with external services through Model Context Protocol (MCP) servers.

## Overview

This project provides a chat interface where users can select an LLM provider and model, then converse with the chosen LLM. The agent leverages the Vercel AI SDK to handle multi-step tool execution, allowing the LLM to interact with configured MCP Servers (e.g., WhatsApp, GitHub, GSuite, Web Search) to fulfill user requests.

## Architecture

The project consists of the following components:

1.  **Frontend (`mcp-agent-app/`):** A Next.js application providing a React-based chat interface accessible at `http://localhost:3000`.
    *   Uses `@ai-sdk/react`'s `useChat` hook for managing chat state and streaming responses.
    *   Uses a React Context (`ChatContext`) to manage application state like the current chat ID, selected provider/model, and to provide access to the `useChat` hook's state and functions.
    *   Includes a Sidebar for selecting LLM providers/models and managing saved chats.
2.  **Chat API (`mcp-agent-app/src/app/api/chat/route.ts`):** A Next.js API route that:
    *   Receives chat messages, provider ID, and model ID from the frontend.
    *   Selects and instantiates the appropriate LLM provider (e.g., `@ai-sdk/google`, `@ai-sdk/anthropic`) based on the request.
    *   Loads MCP server configurations from `mcp-config.json`.
    *   Uses a helper (`prepareStdioArgs`) to resolve paths and environment variables for server commands.
    *   Initializes MCP clients using `experimental_createMCPClient` and `Experimental_StdioMCPTransport` from `ai` and `ai/mcp-stdio`.
    *   Fetches tool schemas directly from the initialized MCP clients using `mcpClient.tools()`.
    *   Calls the Vercel AI SDK's `streamText` function, passing the selected language model, messages, and merged MCP tools.
    *   Relies on `streamText` (with `maxSteps > 1`) to handle the multi-step conversation flow, including automatic tool calling via the MCP clients.
    *   Includes a workaround to disable tools for Anthropic due to current SDK incompatibility with stdio tools.
    *   Streams the response (text chunks, errors) back to the frontend using `result.toDataStream()`.
    *   Closes MCP client connections in the `onFinish` callback.
3.  **Chat Persistence API (`mcp-agent-app/src/app/api/chats/`):** Next.js API routes for saving, loading, listing, and deleting chat sessions using Prisma and a SQLite database. Stores chat history (`CoreMessage[]`), title, provider ID, and model ID.
4.  **MCP Servers:** External processes (Python scripts, Docker containers) implementing the Model Context Protocol (MCP). The Chat API backend launches these servers via `StdioMCPTransport` based on `mcp-config.json`.
5.  **Configuration:**
    *   `mcp-agent-app/mcp-config.json`: Defines available MCP servers, launch commands, and tool schemas (though schemas are primarily discovered dynamically now).
    *   `mcp-agent-app/llm-config.json`: Defines available LLM providers and their models for the frontend UI.
    *   `mcp-agent-app/.env.local`: Stores API keys, tokens, and paths required by the backend and MCP servers.

## Setup

**Prerequisites:**

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
*   [uv](https://astral.sh/uv) (Python package manager)
*   [Docker](https://www.docker.com/get-started/) (for the GitHub MCP server)
*   **LLM API Keys:** Obtain keys for the providers you want to use (Google Gemini, Anthropic Claude, OpenAI GPT, xAI Grok). Set them in `.env.local`.
*   **GitHub Personal Access Token (PAT):** [Create one](https://github.com/settings/personal-access-tokens/new) with appropriate scopes (e.g., `repo`, `read:user`). Set as `GITHUB_PERSONAL_ACCESS_TOKEN` in `.env.local`.
*   **GSuite OAuth2 Credentials:** Follow steps in the [GSuite MCP Server](#gsuite-mcp-server) section.

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
    *   Create `.env.local` in `mcp-agent-app/`.
    *   Add API keys, tokens, and configuration paths. Example:
        ```dotenv
        # .env.local

        # LLM API Keys (Add keys for providers you want to use)
        GOOGLE_API_KEY=YOUR_GEMINI_API_KEY
        ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY
        OPENAI_API_KEY=YOUR_OPENAI_API_KEY
        XAI_API_KEY=YOUR_XAI_API_KEY

        # GitHub Token
        GITHUB_PERSONAL_ACCESS_TOKEN=YOUR_GITHUB_PAT

        # Paths (Adjust if needed, especially if uv isn't in PATH)
        # UV_PATH=/path/to/your/uv # Optional override
        WHATSAPP_MCP_SCRIPT_DIR=../whatsapp-mcp/whatsapp-mcp-server # Relative paths often work
        GSUITE_MCP_SCRIPT_DIR=../mcp-gsuite
        GSUITE_GAUTH_FILE=../mcp-gsuite/.gauth.json
        GSUITE_ACCOUNTS_FILE=../mcp-gsuite/.accounts.json
        GSUITE_CREDENTIALS_DIR=../mcp-gsuite/gsuite-credentials # Directory for storing token.json
        DDG_MCP_SCRIPT_DIR=../duckduckgo-mcp-server

        # Database URL (SQLite)
        DATABASE_URL="file:./dev.db"
        ```
    *   Replace placeholders. Ensure paths are correct relative to the `mcp-agent-app` directory or use absolute paths.
4.  **Setup Database:**
    ```bash
    npx prisma migrate dev --name init # Or your latest migration name
    ```

**Running the Application:**

*   **MCP Servers:** Ensure the required MCP servers are running or accessible (e.g., Docker daemon running for GitHub, other servers started manually if needed, though the app attempts to start them via stdio).
    *   *Note:* The current implementation starts MCP servers on demand via `StdioMCPTransport`. You generally don't need to start them manually unless debugging a specific server. Ensure prerequisites like the WhatsApp Go bridge *are* running if needed by a server.
*   **Start the Next.js App:**
    ```bash
    cd mcp-agent-app
    npm run dev
    # or yarn dev
    ```
*   Open `http://localhost:3000`.

## Usage

*   Select your desired LLM Provider and Model from the sidebar dropdowns.
*   Interact with the chat interface.
*   The agent will use the selected LLM and attempt to use configured MCP tools when appropriate (except for Anthropic, where tools are currently disabled).
*   Use the "Save Chat" button to persist conversations. Load previous chats from the history list.

### Example Prompts:

*   `Who are you?`
*   `Search the web for the latest AI news.` (Uses ddg-search)
*   `Get issue number 1 from the vercel/ai repository.` (Uses github)
*   `Send a WhatsApp message to [Number] saying "Test from MCP Agent"` (Uses whatsapp)
*   `What's on my main Google Calendar today?` (Uses gsuite)

## Adding New MCP Servers

1.  **Implement the MCP Server:** Develop a server communicating via stdio/JSON-RPC.
2.  **Update `mcp-config.json`:** Add a server entry defining its `id`, `description`, and `command` (including `executableEnvVar`/`defaultExecutable`, `argsTemplate`, `scriptDirEnvVar`, `envVars`). Tool schemas in the config are less critical now as they are discovered dynamically, but descriptions are helpful.
3.  **Update `.env.local`:** Add any required environment variables for the new server's command.
4.  **Restart** the `mcp-agent-app`. The backend will attempt to connect and discover tools from the new server.

## Current MCP Servers

*(Descriptions remain largely the same, but execution is now handled by `StdioMCPTransport`)*

### WhatsApp MCP Server

*   **Source:** `whatsapp-mcp/`
*   **Execution:** Python script via `uv run`. Requires Go bridge running separately.
*   **Config:** `WHATSAPP_MCP_SCRIPT_DIR`

### GitHub MCP Server

*   **Source:** Docker Image (`ghcr.io/github/github-mcp-server`)
*   **Execution:** Docker container via `docker run`. Requires Docker daemon running.
*   **Config:** `GITHUB_PERSONAL_ACCESS_TOKEN`

### GSuite MCP Server

*   **Source:** `mcp-gsuite/`
*   **Execution:** Python script via `uv run`.
*   **Config:** `GSUITE_MCP_SCRIPT_DIR`, `GSUITE_GAUTH_FILE`, `GSUITE_ACCOUNTS_FILE`, `GSUITE_CREDENTIALS_DIR`. Requires OAuth2 setup.

### DuckDuckGo Search MCP Server

*   **Source:** `duckduckgo-mcp-server/`
*   **Execution:** Python module via `uv run`.
*   **Config:** `DDG_MCP_SCRIPT_DIR`

## File and Folder Structure

```
mcp-agent/ (Project Root)
├── .gitignore
├── LICENSE
├── README.md (This file)
├── docs/ (Additional documentation)
├── mcp-agent-app/ (Next.js Application)
│   ├── .env.local (API Keys, Paths, DB URL)
│   ├── llm-config.json (LLM Provider/Model definitions for UI)
│   ├── mcp-config.json (MCP server command configurations)
│   ├── next.config.ts
│   ├── package.json
│   ├── prisma/
│   │   └── schema.prisma (Database schema)
│   │   └── migrations/
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── chat/route.ts (Main chat API, uses Vercel AI SDK)
│   │   │   │   └── chats/ (API routes for saving/loading chats)
│   │   │   └── page.tsx (Main page component)
│   │   ├── components/ (React components: ChatInterface, Sidebar, etc.)
│   │   ├── context/
│   │   │   └── ChatContext.tsx (Manages app state, integrates useChat hook)
│   │   └── lib/
│   │       └── prisma.ts (Prisma client instance)
│   └── ... (Other Next.js files)
├── duckduckgo-mcp-server/
├── github-mcp-server/ (Source code, not directly run if using Docker image)
├── mcp-gsuite/
└── whatsapp-mcp/
    ├── whatsapp-bridge/ (Go component - needs separate execution)
    └── whatsapp-mcp-server/ (Python component)

```

## Debugging

*   Check terminal logs for the Next.js server (`npm run dev`). Look for API key status, provider/model usage, MCP init steps, and any errors during `streamText`.
*   Check browser console logs for context actions and potential frontend errors.
*   If an MCP server fails to initialize, check the `prepareStdioArgs` logs and ensure the paths and environment variables in `.env.local` are correct.
*   Verify API keys and tokens.

## License

This project is licensed under the terms of the MIT open source license. Please refer to [MIT](./LICENSE) for the full terms.
