import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/env";
import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { consumeMcpRequest } from "@/lib/mcp/rate-limit";
import { createSprintifyMcpServer } from "@/lib/mcp/server";

export const runtime = "nodejs";

function unauthorized() {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32001, message: "Authentication required." },
      id: null,
    },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="Sprintify MCP"' },
    },
  );
}

function forbiddenOrigin() {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32003, message: "Origin is not allowed." },
      id: null,
    },
    { status: 403 },
  );
}

function tooManyRequests() {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32029, message: "Too many requests. Try again soon." },
      id: null,
    },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}

async function handle(request: Request) {
  // MCP clients such as Codex and Claude are not browser requests and omit
  // Origin. If a browser does send it, pin it to this app to prevent a hostile
  // site from using a credentialed local/remote MCP endpoint via DNS rebinding.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env.BETTER_AUTH_URL).origin) {
    return forbiddenOrigin();
  }

  if (!(await consumeMcpRequest(request))) return tooManyRequests();

  const actor = await authenticateMcpRequest(request);
  if (!actor) return unauthorized();

  try {
    // Stateless transport makes the route safe across server instances and
    // works with Claude and Codex without a session store.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createSprintifyMcpServer(actor);
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    Sentry.captureException(error, { extra: { route: "/api/mcp" } });
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Unable to process the MCP request." },
        id: null,
      },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
