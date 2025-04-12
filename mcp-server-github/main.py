import os
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from github import Github, GithubException
from dotenv import load_dotenv

load_dotenv()  # Load environment variables from .env file

app = FastAPI(title="GitHub MCP Server")

# --- Authentication (Example using PAT from Env) ---
# In a real app, consider more robust auth methods if needed
github_pat = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
g = None  # Initialize g to None
if not github_pat:
    print("WARNING: GITHUB_PERSONAL_ACCESS_TOKEN not found in environment variables.")
    # Depending on requirements, you might raise an error or allow limited functionality
    # raise ValueError("Missing GITHUB_PERSONAL_ACCESS_TOKEN environment variable")
else:
    # Ensure PAT is loaded correctly before initializing Github instance
    try:
        g = Github(github_pat)
        user = g.get_user()  # Test authentication
        print(f"Successfully authenticated as GitHub user: {user.login}")
    except Exception as e:
        print(f"ERROR: Failed to authenticate with GitHub PAT: {e}")
        g = None  # Authentication failed


# --- Pydantic Models for Request Bodies ---
class GetIssueParams(BaseModel):
    owner: str
    repo: str
    issue_number: int


# --- API Endpoints (Matching Tool Definitions) ---


@app.post("/get_issue")
async def get_issue(params: GetIssueParams):
    print(f"Received request for /get_issue with params: {params}")
    if g is None:  # Check if authentication failed or PAT was missing
        raise HTTPException(
            status_code=503,
            detail="GitHub client not authenticated. Check PAT or server logs.",
        )
    try:
        repo = g.get_repo(f"{params.owner}/{params.repo}")
        issue = repo.get_issue(params.issue_number)
        # Return relevant details, not the whole object usually
        return {
            "number": issue.number,
            "title": issue.title,
            "state": issue.state,
            "url": issue.html_url,
            "user": issue.user.login,
            "body": issue.body,  # Be mindful of length
        }
    except GithubException as e:
        print(f"GitHub API Error: {e.status} - {e.data}")
        raise HTTPException(
            status_code=e.status,
            detail=f"GitHub API Error: {e.data.get('message', 'Unknown error')}",
        )
    except Exception as e:
        print(f"Error processing /get_issue: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/")
async def read_root():
    return {"message": "GitHub MCP Server is running"}


# --- Optional: Add Uvicorn runner for direct execution (for local dev) ---
# if __name__ == "__main__":
#     import uvicorn
#     port = int(os.getenv("PORT", 8001)) # Default port 8001
#     print(f"Starting GitHub MCP Server on port {port}")
#     uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
