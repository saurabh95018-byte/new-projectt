const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createServer, validateProposalInput } = require("../server");

const validInput = {
  jobTitle: "Build a thoughtful brand identity",
  jobDescription: "We need a visual identity for an independent coffee company and its online store.",
};

test("validates required proposal fields and job description length", () => {
  assert.equal(validateProposalInput(validInput), null);
  assert.match(validateProposalInput({ ...validInput, jobTitle: " " }), /jobTitle is required/);
  assert.match(validateProposalInput({ ...validInput, jobDescription: "Too short" }), /at least 40 characters/);
  assert.match(validateProposalInput({ ...validInput, skills: 42 }), /skills must be text/);
});

test("serves health status without exposing provider secrets", async (context) => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const server = createServer();
  context.after(() => {
    server.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", generationConfigured: false });
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("rejects invalid requests and serves the application shell", async (context) => {
  const server = createServer();
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const invalid = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...validInput, jobDescription: "Too brief" }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /at least 40 characters/);
  const malformedPath = await fetch(`${baseUrl}/%ZZ`);
  assert.equal(malformedPath.status, 400);
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const unconfigured = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validInput),
  });
  assert.equal(unconfigured.status, 503);
  assert.match((await unconfigured.json()).error, /not configured/);
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.match(await home.text(), /Bidplot/);
});

test("generates a proposal through the configured provider without returning its key", async (context) => {
  const previousEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  };
  const received = {};
  const provider = http.createServer(async (request, response) => {
    received.authorization = request.headers.authorization;
    received.body = JSON.parse(await new Promise((resolve) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => resolve(body));
    }));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "Hello! I can help create your coffee brand identity." } }] }));
  });
  const server = createServer();
  context.after(() => {
    server.close();
    provider.close();
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.OPENAI_API_KEY = "test-server-key";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
  process.env.OPENAI_MODEL = "test-model";
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validInput),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { proposal: "Hello! I can help create your coffee brand identity." });
  assert.equal(received.authorization, "Bearer test-server-key");
  assert.equal(received.body.model, "test-model");
  assert.match(received.body.messages[1].content, /Build a thoughtful brand identity/);
});

test("explains common provider configuration errors without exposing provider responses", async (context) => {
  const previousEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  };
  let providerStatus = 401;
  const provider = http.createServer((request, response) => {
    response.writeHead(providerStatus, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Sensitive provider response containing private details." } }));
  });
  const server = createServer();
  context.after(() => {
    server.close();
    provider.close();
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.OPENAI_API_KEY = "test-server-key";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const expectedErrors = [
    [401, /rejected OPENAI_API_KEY/],
    [403, /denied access/],
    [404, /endpoint or model was not found/],
    [429, /usage quota was reached/],
  ];
  for (const [status, message] of expectedErrors) {
    providerStatus = status;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validInput),
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, message);
    assert.doesNotMatch(body.error, /Sensitive provider response/);
  }
});
