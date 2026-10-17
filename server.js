const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const publicDirectory = path.join(__dirname, "public");
const maxBodyBytes = 80 * 1024;
const rateWindowMs = 10 * 60 * 1000;
const rateLimit = 10;
const requestsByAddress = new Map();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request must contain valid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function validateProposalInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "Request must be a JSON object.";
  }

  const fields = [
    ["jobTitle", 160, true],
    ["jobDescription", 12000, true],
    ["skills", 1000, false],
    ["experience", 4000, false],
    ["rate", 80, false],
    ["tone", 40, false],
  ];

  for (const [name, limit, required] of fields) {
    const value = input[name] ?? "";
    if (typeof value !== "string" || value.length > limit) {
      return `${name} must be text no longer than ${limit} characters.`;
    }
    if (required && !value.trim()) {
      return `${name} is required.`;
    }
  }

  if (input.jobDescription.trim().length < 40) {
    return "Add at least 40 characters of job details so the proposal can be tailored.";
  }

  return null;
}

function isRateLimited(address) {
  const now = Date.now();
  const timestamps = (requestsByAddress.get(address) || []).filter(
    (timestamp) => now - timestamp < rateWindowMs,
  );
  if (timestamps.length >= rateLimit) {
    requestsByAddress.set(address, timestamps);
    return true;
  }
  timestamps.push(now);
  requestsByAddress.set(address, timestamps);
  return false;
}

function proposalPrompt(input) {
  return [
    "Write one original, client-focused Upwork proposal based only on the freelancer information and job details below.",
    "Address the client's specific needs, explain a credible approach, and end with one natural, relevant question.",
    "Use a concise opening, clear paragraphs, and a confident but human voice. Avoid generic claims, invented credentials,",
    "unsupported promises, fake results, markdown headings, and repeating the job post. Never claim experience not provided.",
    `Tone: ${input.tone || "Confident and friendly"}.`,
    `Job title: ${input.jobTitle}`,
    `Job details:\n${input.jobDescription}`,
    `Relevant skills: ${input.skills || "Not provided"}`,
    `Freelancer experience and proof points:\n${input.experience || "Not provided; do not invent any."}`,
    `Rate or budget context: ${input.rate || "Not provided"}`,
  ].join("\n\n");
}

async function generateProposal(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, error: "Proposal generation is not configured. Add OPENAI_API_KEY to the server environment." };
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 650,
        messages: [
          { role: "system", content: "You are Bidplot, an honest, thoughtful freelance proposal writing assistant." },
          { role: "user", content: proposalPrompt(input) },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      return { statusCode: 504, error: "The AI service took too long to respond. Please try again." };
    }
    return { statusCode: 502, error: "Could not reach the AI service. Check the server connection and try again." };
  }

  if (!upstream.ok) {
    const messages = {
      400: "The AI provider rejected the request. Check OPENAI_MODEL is supported by your provider.",
      401: "The AI provider rejected OPENAI_API_KEY. Check that it is a valid secret API key, then restart the server.",
      403: "The AI provider denied access. Check your account permissions, project access, and billing status.",
      404: "The AI endpoint or model was not found. Check OPENAI_BASE_URL and OPENAI_MODEL.",
      429: "The AI provider rate limit or usage quota was reached. Check your provider account's limits and billing, then try again.",
    };
    const error = messages[upstream.status]
      || `The AI provider returned HTTP ${upstream.status}. Check your provider settings and try again.`;
    console.error(`AI provider returned HTTP ${upstream.status}.`);
    return { statusCode: 502, error };
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    return { statusCode: 502, error: "The AI service returned an invalid response. Please try again." };
  }

  const proposal = result.choices?.[0]?.message?.content;
  if (typeof proposal !== "string" || !proposal.trim()) {
    return { statusCode: 502, error: "The AI service returned an empty proposal. Please try again." };
  }
  return { statusCode: 200, proposal: proposal.trim() };
}

function createServer() {
  return http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");

    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { status: "ok", generationConfigured: Boolean(process.env.OPENAI_API_KEY) });
    }

    if (request.method === "POST" && url.pathname === "/api/generate") {
      const address = request.socket.remoteAddress || "unknown";
      if (isRateLimited(address)) {
        return sendJson(response, 429, { error: "Too many generation requests. Please wait a few minutes and try again." });
      }
      try {
        const input = await readJson(request);
        const validationError = validateProposalInput(input);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }
        const result = await generateProposal(input);
        return sendJson(response, result.statusCode, result.statusCode === 200 ? { proposal: result.proposal } : { error: result.error });
      } catch (error) {
        if (!response.headersSent && !response.destroyed) {
          return sendJson(response, error.statusCode || 400, { error: error.message || "Could not read the request." });
        }
        return;
      }
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD, POST" });
      return response.end();
    }

    let requestedPath;
    try {
      requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400);
      return response.end("Invalid path");
    }
    const filePath = path.resolve(publicDirectory, `.${requestedPath}`);
    if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
      response.writeHead(403);
      return response.end("Forbidden");
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500);
        return response.end(error.code === "ENOENT" ? "Not found" : "Unable to read file");
      }
      response.writeHead(200, {
        "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, "0.0.0.0", () => {
    console.log(`Bidplot is running on http://localhost:${port}`);
  });
}

module.exports = { createServer, validateProposalInput };
