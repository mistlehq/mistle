import type { IntegrationEgressRequestMiddleware } from "@mistle/integrations-core";

import { GitHubRequestMiddlewareIds } from "./egress-request-middleware.js";

type JsonRecord = Record<string, unknown>;

const GitHubSessionLinkLabel = "🔗 View session";

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMarkdownTargetRequest(input: { method: string; pathname: string }): boolean {
  if (input.method !== "POST") {
    return false;
  }

  return [
    /\/repos\/[^/]+\/[^/]+\/issues$/,
    /\/repos\/[^/]+\/[^/]+\/issues\/[^/]+\/comments$/,
    /\/repos\/[^/]+\/[^/]+\/pulls$/,
    /\/repos\/[^/]+\/[^/]+\/pulls\/[^/]+\/comments$/,
  ].some((pattern) => pattern.test(input.pathname));
}

function createMarkdownFooter(sessionUrl: string): string {
  return `\n\n---\n[${GitHubSessionLinkLabel}](${sessionUrl})`;
}

export const AppendSessionLinkToGitHubMarkdownRequestMiddleware: IntegrationEgressRequestMiddleware =
  {
    id: GitHubRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MARKDOWN,
    handle({ ctx, request }) {
      if (
        request.body === undefined ||
        !isMarkdownTargetRequest({
          method: request.method,
          pathname: request.url.pathname,
        })
      ) {
        return request;
      }

      const decodedBody = new TextDecoder().decode(request.body);
      const parsedBody: unknown = JSON.parse(decodedBody);
      if (!isJsonRecord(parsedBody)) {
        return request;
      }

      const currentBody = parsedBody["body"];
      const footer = createMarkdownFooter(ctx.sessionUrl);
      if (typeof currentBody !== "string" || currentBody.includes(footer)) {
        return request;
      }

      parsedBody["body"] = `${currentBody}${footer}`;
      request.body = new TextEncoder().encode(JSON.stringify(parsedBody));
      return request;
    },
  };
