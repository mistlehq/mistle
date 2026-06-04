import type { IntegrationEgressRequestMiddleware } from "@mistle/integrations-core";

import { SlackRequestMiddlewareIds } from "./egress-request-middleware.js";

const SlackSessionLinkBlockId = "mistle_session_link";
const SlackSessionLinkActionId = "mistle_view_session";
const SlackSessionLinkLabel = "View session";
const SlackMessageEndpointSuffixes = ["/chat.postMessage", "/chat.update"] as const;
const SlackMaximumMessageBlocks = 50;
const SlackMaximumActionsBlockElements = 25;
const SlackMaximumSectionTextLength = 3_000;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObjectArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isJsonObject);
}

function containsSlackSessionLinkButton(blocks: ReadonlyArray<Record<string, unknown>>): boolean {
  return blocks.some((block) => {
    if (block.block_id === SlackSessionLinkBlockId) {
      return true;
    }

    const elements = block.elements;
    if (!Array.isArray(elements)) {
      return false;
    }

    return elements.some((element) => {
      return isJsonObject(element) && element.action_id === SlackSessionLinkActionId;
    });
  });
}

function createSlackTextSectionBlock(text: string): Record<string, unknown> {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text,
    },
  };
}

function createSlackSessionLinkButtonBlock(sessionUrl: string): Record<string, unknown> {
  return {
    type: "actions",
    block_id: SlackSessionLinkBlockId,
    elements: [createSlackSessionLinkButtonElement(sessionUrl)],
  };
}

function createSlackSessionLinkButtonElement(sessionUrl: string): Record<string, unknown> {
  return {
    type: "button",
    action_id: SlackSessionLinkActionId,
    text: {
      type: "plain_text",
      text: SlackSessionLinkLabel,
    },
    url: sessionUrl,
  };
}

function appendSlackSessionLinkButtonToBlocks(input: {
  blocks: ReadonlyArray<Record<string, unknown>>;
  sessionUrl: string;
}): Array<Record<string, unknown>> | null {
  if (containsSlackSessionLinkButton(input.blocks)) {
    return null;
  }

  const actionBlockIndex = input.blocks.findIndex((block) => {
    return (
      block.type === "actions" &&
      Array.isArray(block.elements) &&
      block.elements.length < SlackMaximumActionsBlockElements
    );
  });
  if (actionBlockIndex >= 0) {
    return input.blocks.map((block, index) => {
      if (index !== actionBlockIndex || !Array.isArray(block.elements)) {
        return block;
      }

      return {
        ...block,
        elements: [...block.elements, createSlackSessionLinkButtonElement(input.sessionUrl)],
      };
    });
  }

  if (input.blocks.length >= SlackMaximumMessageBlocks) {
    return null;
  }

  return [...input.blocks, createSlackSessionLinkButtonBlock(input.sessionUrl)];
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
    const currentBlocks = parsedBody["blocks"];
    if (isJsonObjectArray(currentBlocks)) {
      const nextBlocks = appendSlackSessionLinkButtonToBlocks({
        blocks: currentBlocks,
        sessionUrl: ctx.sessionUrl,
      });
      if (nextBlocks === null) {
        return request;
      }

      parsedBody["blocks"] = nextBlocks;
      request.body = new TextEncoder().encode(JSON.stringify(parsedBody));
      return request;
    }

    if (
      currentBlocks !== undefined ||
      typeof currentText !== "string" ||
      currentText.length < 1 ||
      currentText.length > SlackMaximumSectionTextLength
    ) {
      return request;
    }

    parsedBody["blocks"] = [
      createSlackTextSectionBlock(currentText),
      createSlackSessionLinkButtonBlock(ctx.sessionUrl),
    ];
    request.body = new TextEncoder().encode(JSON.stringify(parsedBody));
    return request;
  },
};
