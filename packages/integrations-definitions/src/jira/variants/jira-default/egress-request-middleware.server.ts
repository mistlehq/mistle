import type { IntegrationEgressRequestMiddleware } from "@mistle/integrations-core";

import { JiraRequestMiddlewareIds } from "./egress-request-middleware.js";

const JiraSessionLinkLabel = "🔗 View session";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveNestedRecord(input: JsonRecord, path: readonly string[]): JsonRecord | undefined {
  let current: JsonRecord = input;

  for (const segment of path) {
    const next = current[segment];
    if (!isJsonRecord(next)) {
      return undefined;
    }

    current = next;
  }

  return current;
}

function resolveTargetDocument(input: {
  method: string;
  pathname: string;
  requestBody: JsonRecord;
}): JsonRecord | undefined {
  if (input.method === "POST" && /\/rest\/api\/3\/issue\/[^/]+\/comment$/.test(input.pathname)) {
    const commentBody = input.requestBody["body"];
    return isJsonRecord(commentBody) ? commentBody : undefined;
  }

  if (input.method === "PUT" && /\/rest\/api\/3\/issue\/[^/]+$/.test(input.pathname)) {
    return resolveNestedRecord(input.requestBody, ["fields", "description"]);
  }

  if (input.method === "POST" && /\/rest\/api\/3\/issue$/.test(input.pathname)) {
    return resolveNestedRecord(input.requestBody, ["fields", "description"]);
  }

  return undefined;
}

function isJiraDocument(value: JsonRecord): boolean {
  return value["type"] === "doc" && value["version"] === 1 && Array.isArray(value["content"]);
}

function createSessionLinkFooter(sessionUrl: string): ReadonlyArray<JsonRecord> {
  return [
    {
      type: "rule",
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: JiraSessionLinkLabel,
          marks: [
            {
              type: "link",
              attrs: {
                href: sessionUrl,
              },
            },
          ],
        },
      ],
    },
  ];
}

function hasSessionLinkFooter(document: JsonRecord, sessionUrl: string): boolean {
  const content = document["content"];
  if (!Array.isArray(content) || content.length < 2) {
    return false;
  }

  for (let index = 0; index <= content.length - 2; index += 1) {
    const ruleNode = content[index];
    const paragraphNode = content[index + 1];
    if (!isJsonRecord(ruleNode) || !isJsonRecord(paragraphNode)) {
      continue;
    }

    if (ruleNode["type"] !== "rule" || paragraphNode["type"] !== "paragraph") {
      continue;
    }

    const paragraphContent = paragraphNode["content"];
    if (!Array.isArray(paragraphContent) || paragraphContent.length !== 1) {
      continue;
    }

    const textNode = paragraphContent[0];
    if (!isJsonRecord(textNode) || textNode["type"] !== "text") {
      continue;
    }

    if (textNode["text"] !== JiraSessionLinkLabel) {
      continue;
    }

    const marks = textNode["marks"];
    if (!Array.isArray(marks) || marks.length !== 1) {
      continue;
    }

    const linkMark = marks[0];
    if (!isJsonRecord(linkMark) || linkMark["type"] !== "link") {
      continue;
    }

    const attrs = linkMark["attrs"];
    if (!isJsonRecord(attrs)) {
      continue;
    }

    if (attrs["href"] === sessionUrl) {
      return true;
    }
  }

  return false;
}

export const AppendSessionLinkToJiraDocumentRequestMiddleware: IntegrationEgressRequestMiddleware =
  {
    id: JiraRequestMiddlewareIds.APPEND_SESSION_LINK_TO_DOCUMENT,
    handle({ ctx, request }) {
      if (request.body === undefined) {
        return request;
      }

      const decodedBody = new TextDecoder().decode(request.body);
      const parsedBody: unknown = JSON.parse(decodedBody);
      if (!isJsonRecord(parsedBody)) {
        return request;
      }

      const targetDocument = resolveTargetDocument({
        method: request.method,
        pathname: request.url.pathname,
        requestBody: parsedBody,
      });
      if (targetDocument === undefined || !isJiraDocument(targetDocument)) {
        return request;
      }

      if (hasSessionLinkFooter(targetDocument, ctx.sessionUrl)) {
        return request;
      }

      const content = targetDocument["content"];
      if (!Array.isArray(content)) {
        return request;
      }

      content.push(...createSessionLinkFooter(ctx.sessionUrl));
      request.body = new TextEncoder().encode(JSON.stringify(parsedBody));
      return request;
    },
  };
