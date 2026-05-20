import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import { ReleaseVersionHeaderName } from "../release-version-header.js";
import type { AppContextBindings } from "../types.js";

type CreateCorsMiddlewareInput = {
  trustedOrigins: readonly string[];
};

export function createCorsMiddleware(
  input: CreateCorsMiddlewareInput,
): MiddlewareHandler<AppContextBindings> {
  const trustedOriginSet = new Set<string>(input.trustedOrigins);

  return cors({
    origin: (origin) => {
      if (origin.length === 0) {
        return "";
      }
      if (trustedOriginSet.has(origin)) {
        return origin;
      }
      return "";
    },
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "Last-Event-ID",
      "mcp-protocol-version",
      "mcp-session-id",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: [
      "Content-Length",
      "mcp-protocol-version",
      "mcp-session-id",
      ReleaseVersionHeaderName,
    ],
    maxAge: 600,
    credentials: true,
  });
}
