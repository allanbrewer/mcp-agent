# MCP Agent

A web-based conversational agent powered by Google Gemini that can interact with various external services via the Model Context Protocol (MCP).

## Overview

This project provides a chat interface where users can converse with Google Gemini. The key feature is the agent's ability to understand requests that require interaction with external tools (MCP Servers) and execute those actions. Currently, it integrates with the official GitHub MCP Server to perform actions like fetching issue details.

## Architecture

The project consists of two main parts:

1.  **`mcp-agent-app/`**: A Next.js application providing:
    *   **Frontend:** A React-based chat interface (`http://localhost:3000`).
    *   **Backend:** An API route (`/api/chat`) that:
        *   Manages the conversation flow with the frontend.
        *   Communicates with the Google Gemini API.
        *   Orchestrates calls to MCP servers based on Gemini's responses.
2.  **MCP Server Integration (Example: GitHub)**:
    *   The Next.js backend dynamically spawns the official GitHub MCP Server (`ghcr.io/github/github-mcp-server`) in a Docker container when a GitHub-related action is requested.
    *   Communication happens via standard input/output (stdio) using the JSON-RPC format defined by the Model Context Protocol.
    *   The source code for the GitHub MCP server is included in the `github-mcp-server/` directory for reference but is ignored by Git via the top-level `.gitignore`.

## Setup

**Prerequisites:**

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
*   [Docker](https://www.docker.com/get-started/)
*   **Google Gemini API Key:** Obtainable from [Google AI Studio](https://aistudio.google.com/app/apikey).
*   **GitHub Personal Access Token (PAT):** [Create one here](https://github.com/settings/personal-access-tokens/new) with appropriate scopes (e.g., `repo`, `read:user`) for the actions you want the agent to perform.

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
    *   Add your API keys/tokens to this file:
        ```dotenv
        # .env.local
        GOOGLE_API_KEY=YOUR_GEMINI_API_KEY
        GITHUB_PERSONAL_ACCESS_TOKEN=YOUR_GITHUB_PAT
        ```
    *   Replace `YOUR_GEMINI_API_KEY` and `YOUR_GITHUB_PAT` with your actual credentials.

**Running the Application:**

1.  Ensure Docker Desktop (or Docker daemon) is running.
2.  Navigate to the Next.js app directory:
    ```bash
    cd mcp-agent-app
    ```
3.  Start the development server:
    ```bash
    npm run dev
    # or yarn dev
    ```
4.  Open your browser and go to `http://localhost:3000`.

## Usage

*   Interact with the chat interface as you would with Gemini.
*   To trigger a GitHub action (currently `get_issue` is implemented), formulate a prompt that includes the specific action pattern the backend looks for. Example:
    `Please get issue number 1 from the repository octocat/Spoon-Knife using the GitHub MCP server action: [[ACTION:GITHUB_GET_ISSUE owner=octocat repo=Spoon-Knife issue_number=1]]`
*   The agent should respond with either the direct Gemini reply or the result (or error) from the executed GitHub action.

## Adding New MCP Servers

The current architecture uses Docker and stdio/MCP for the GitHub server. To add support for a new MCP server:

1.  **Identify Server Details:** Determine how the new server is run (e.g., Docker image, executable) and how it communicates (e.g., stdio/MCP, HTTP API).
2.  **Backend Modification (`mcp-agent-app/src/app/api/chat/route.ts`):**
    *   **Action Detection:** Add logic to detect a new action pattern in Gemini's response (e.g., `[[ACTION:NEW_SERVICE_ACTION param1=...]]`). Use regex to extract parameters.
    *   **Execution Logic:**
        *   If it uses Docker/stdio like the GitHub server: Adapt the existing `spawn` logic to use the new server's Docker image and construct the appropriate JSON-RPC request based on its MCP definition.
        *   If it exposes an HTTP API: Use `fetch` to call the server's endpoint with the necessary parameters and authentication.
        *   If it's a different type of executable: Use `spawn` or other `child_process` methods as needed.
    *   **Response Handling:** Parse the response from the new server and format it appropriately for the frontend chat.
    *   **Error Handling:** Implement robust error handling for the new integration path.
3.  **Environment Variables:** Add any new required API keys or configuration to `mcp-agent-app/.env.local`.
4.  **Documentation:** Update this README to include the new server and its usage.

## Current MCP Servers

*   **GitHub MCP Server:**
    *   **Source:** `github-mcp-server/` (cloned, for reference)
    *   **Execution:** Via Docker image `ghcr.io/github/github-mcp-server`
    *   **Communication:** Stdio / MCP (JSON-RPC)
    *   **Configuration:** Requires `GITHUB_PERSONAL_ACCESS_TOKEN` in `.env.local`.
