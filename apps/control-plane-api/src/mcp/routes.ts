import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { Hono } from "hono";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { MCP_ROUTE_BASE_PATH } from "./constants.js";
import { createMistleMcpServer } from "./server.js";

export function createMcpRoutes(): AppRoutes<typeof MCP_ROUTE_BASE_PATH> {
  const routes = new Hono<AppContextBindings>();

  routes.all("/", async (ctx) => {
    const organizationActor = ctx.get("organizationActor");
    if (organizationActor === null) {
      throw new Error("Expected organization actor to be available.");
    }

    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createMistleMcpServer({
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      organizationActor,
      sandboxConfig: ctx.get("sandboxConfig"),
    });
    await server.connect(transport);

    return transport.handleRequest(ctx.req.raw);
  });

  return {
    basePath: MCP_ROUTE_BASE_PATH,
    routes,
  };
}
