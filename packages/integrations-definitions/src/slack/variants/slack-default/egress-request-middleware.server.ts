import type { IntegrationEgressRequestMiddleware } from "@mistle/integrations-core";

import { SlackRequestMiddlewareIds } from "./egress-request-middleware.js";

const SlackSessionLinkDivider = "\n\n──────────\n";
const SlackSessionLinkLabel = "🔗 View session";
const SlackMessageEndpointSuffixes = ["/chat.postMessage", "/chat.update"] as const;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createSlackSessionLinkFooter(sessionUrl: string): string {
  return `${SlackSessionLinkDivider}<${sessionUrl}|${SlackSessionLinkLabel}>`;
}

function appendSlackSessionLink(text: string, sessionUrl: string): string {
  return `${text}${createSlackSessionLinkFooter(sessionUrl)}`;
}

export const AppendSessionLinkToSlackTextRequestMiddleware: IntegrationEgressRequestMiddleware = {
  id: SlackRequestMiddlewareIds.APPEND_SESSION_LINK_TO_TEXT,
  handle({ ctx, request }) {
    if (
      request.method !== "POST" ||
      !SlackMessageEndpointSuffixes.some((suffix) => request.url.pathname.endsWith(suffix))
    ) {
      return request;
    }

    if (request.body === undefined) {
      return request;
    }

    const decodedBody = new TextDecoder().decode(request.body);
    const parsedBody: unknown = JSON.parse(decodedBody);
    if (!isJsonObject(parsedBody)) {
      return request;
    }

    const currentText = parsedBody["text"];
    if (
      typeof currentText !== "string" ||
      currentText.includes(createSlackSessionLinkFooter(ctx.sessionUrl))
    ) {
      return request;
    }

    parsedBody["text"] = appendSlackSessionLink(currentText, ctx.sessionUrl);
    request.body = new TextEncoder().encode(JSON.stringify(parsedBody));
    return request;
  },
};
