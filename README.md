# Bidplot AI

Bidplot is a lightweight Upwork proposal-writing workspace. Add a job description and your real experience, generate a draft with an OpenAI-compatible chat completions API, edit it in place, then copy or save it in your browser. Bidplot does not connect to Upwork or submit proposals.

## Requirements

- Node.js 20 or newer
- An OpenAI API key to generate proposals

## Run locally

1. Set `OPENAI_API_KEY` in your shell, then run `npm start`. The included `RUN.TXT` prompts for the key without putting it in the script.
   - PowerShell: `$secureKey = Read-Host "Paste your real OpenAI API key" -AsSecureString; $env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password; npm start`
   - Or copy `.env.example` to `.env` and load its values yourself; Node.js does not load `.env` files automatically.
   - macOS/Linux: `export OPENAI_API_KEY="your-key" && npm start`
3. Open [http://localhost:3000](http://localhost:3000).

Optional environment settings: `OPENAI_BASE_URL`, `OPENAI_MODEL`, and `PORT`. The server accepts an OpenAI-compatible `/chat/completions` endpoint; keep provider credentials on the server and do not expose them in browser code.

Without a provider key the app, local drafts, and health endpoint still work, but proposal generation returns an explicit configuration error. Provider errors identify common causes such as invalid API keys, account permissions or billing, missing models/endpoints, and usage limits without returning raw provider responses.

## Privacy and deployment

Proposal inputs are sent from the server to the configured AI provider when generation is requested. Saved proposals and the optional profile name are stored in this browser's local storage; clearing browser storage removes them. The server does not persist job descriptions or generated proposals.

The built-in in-memory rate limit is per server process and client IP; deployments behind a reverse proxy should configure network-level rate limiting and only trust proxy headers when the proxy is controlled. For a public multi-user production deployment, add authentication, durable user-scoped storage, and a shared rate limiter before exposing the service. Serve it behind HTTPS and configure provider usage limits and privacy terms appropriate to your deployment.

## Checks

```sh
npm test
```
