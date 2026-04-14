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

function isGraphqlRequest(input: { method: string; pathname: string }): boolean {
  if (input.method !== "POST") {
    return false;
  }

  return input.pathname.endsWith("/graphql");
}

function isAddCommentMutation(query: string): boolean {
  return /addComment\s*\(/.test(query);
}

function createMarkdownFooter(sessionUrl: string): string {
  return `\n\n---\n[${GitHubSessionLinkLabel}](${sessionUrl})`;
}

function appendFooterToBody(input: { currentBody: string; footer: string }): string {
  if (input.currentBody.includes(input.footer)) {
    return input.currentBody;
  }

  return `${input.currentBody}${input.footer}`;
}

function applyRestMarkdownFooter(input: { parsedBody: JsonRecord; footer: string }): boolean {
  const currentBody = input.parsedBody["body"];
  if (typeof currentBody !== "string") {
    return false;
  }

  input.parsedBody["body"] = appendFooterToBody({
    currentBody,
    footer: input.footer,
  });
  return true;
}

function applyGraphqlMarkdownFooter(input: { parsedBody: JsonRecord; footer: string }): boolean {
  const query = input.parsedBody["query"];
  if (typeof query !== "string" || !isAddCommentMutation(query)) {
    return false;
  }

  const variables = input.parsedBody["variables"];
  if (!isJsonRecord(variables)) {
    return false;
  }

  const graphqlInput = variables["input"];
  if (!isJsonRecord(graphqlInput)) {
    return false;
  }

  const currentBody = graphqlInput["body"];
  if (typeof currentBody !== "string") {
    return false;
  }

  graphqlInput["body"] = appendFooterToBody({
    currentBody,
    footer: input.footer,
  });
  return true;
}

export const AppendSessionLinkToGitHubMarkdownRequestMiddleware: IntegrationEgressRequestMiddleware =
  {
    id: GitHubRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MARKDOWN,
    handle({ ctx, request }) {
      if (request.body === undefined) {
        return request;
      }

      const requestShape = {
        method: request.method,
        pathname: request.url.pathname,
      };
      if (!isMarkdownTargetRequest(requestShape) && !isGraphqlRequest(requestShape)) {
        return request;
      }

      const decodedBody = new TextDecoder().decode(request.body);
      const parsedBody: unknown = JSON.parse(decodedBody);
      if (!isJsonRecord(parsedBody)) {
        return request;
      }

      const footer = createMarkdownFooter(ctx.sessionUrl);
      const didMutate = isMarkdownTargetRequest(requestShape)
        ? applyRestMarkdownFooter({
            parsedBody,
            footer,
          })
        : applyGraphqlMarkdownFooter({
            parsedBody,
            footer,
          });
      if (!didMutate) {
        return request;
      }

      request.body = new TextEncoder().encode(JSON.stringify(parsedBody));
      return request;
    },
  };
