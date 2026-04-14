import type { IntegrationEgressRequestMiddleware } from "@mistle/integrations-core";

import { LinearRequestMiddlewareIds } from "./egress-request-middleware.js";

const LinearMcpPathname = "/mcp";
const LinearSessionLinkFooterLabel = "🔗 View session";
const LinearToolsCallMethod = "tools/call";
const LinearCreateIssueToolName = "save_issue";
const LinearCreateCommentToolName = "save_comment";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createLinearSessionLinkFooter(sessionUrl: string): string {
  return `\n\n---\n[${LinearSessionLinkFooterLabel}](${sessionUrl})`;
}

function resolveTargetField(parsedBody: JsonRecord):
  | {
      parent: JsonRecord;
      key: "description" | "body";
      value: string;
    }
  | undefined {
  if (parsedBody["method"] !== LinearToolsCallMethod) {
    return undefined;
  }

  const params = parsedBody["params"];
  if (!isJsonRecord(params)) {
    return undefined;
  }

  const toolName = params["name"];
  const argumentsRecord = params["arguments"];
  if (typeof toolName !== "string" || !isJsonRecord(argumentsRecord) || "id" in argumentsRecord) {
    return undefined;
  }

  if (toolName === LinearCreateIssueToolName) {
    const description = argumentsRecord["description"];
    if (typeof description !== "string") {
      return undefined;
    }

    return {
      parent: argumentsRecord,
      key: "description",
      value: description,
    };
  }

  if (toolName === LinearCreateCommentToolName) {
    const body = argumentsRecord["body"];
    if (typeof body !== "string") {
      return undefined;
    }

    return {
      parent: argumentsRecord,
      key: "body",
      value: body,
    };
  }

  return undefined;
}

export const AppendSessionLinkToLinearMcpMarkdownRequestMiddleware: IntegrationEgressRequestMiddleware =
  {
    id: LinearRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MCP_MARKDOWN,
    handle({ ctx, request }) {
      if (
        request.method !== "POST" ||
        request.url.pathname !== LinearMcpPathname ||
        request.body === undefined
      ) {
        return request;
      }

      const decodedBody = new TextDecoder().decode(request.body);
      const parsedBody: unknown = JSON.parse(decodedBody);
      if (!isJsonRecord(parsedBody)) {
        return request;
      }

      const targetField = resolveTargetField(parsedBody);
      if (targetField === undefined) {
        return request;
      }

      const footer = createLinearSessionLinkFooter(ctx.sessionUrl);
      if (targetField.value.includes(footer)) {
        return request;
      }

      targetField.parent[targetField.key] = `${targetField.value}${footer}`;
      request.body = new TextEncoder().encode(JSON.stringify(parsedBody));
      return request;
    },
  };
