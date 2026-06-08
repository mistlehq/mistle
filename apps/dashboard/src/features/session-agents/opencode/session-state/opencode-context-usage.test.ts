import type {
  OpenCodeMessage,
  OpenCodeProviderSummary,
} from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import { describe, expect, it } from "vitest";

import type { OpenCodeChatState } from "./opencode-chat-state.js";
import { formatOpenCodeContextUsage } from "./opencode-context-usage.js";

function createChatState(messages: readonly OpenCodeMessage[]): OpenCodeChatState {
  return {
    completedErrorMessage: null,
    entries: [],
    messageOrder: messages.map((message) => message.id),
    messagesById: Object.fromEntries(
      messages.map((message) => [
        message.id,
        {
          info: message,
          partOrder: [],
          partsById: {},
        },
      ]),
    ),
    pendingPermissions: [],
    sessionId: "ses_test",
    status: "idle",
  };
}

function createUserMessage(id: string): Extract<OpenCodeMessage, { role: "user" }> {
  return {
    agent: "build",
    id,
    model: {
      modelID: "gpt-5",
      providerID: "openai",
    },
    role: "user",
    sessionID: "ses_test",
    time: {
      created: 1,
    },
  };
}

function createAssistantMessage(input: {
  cost: number;
  id: string;
  inputTokens: number;
  modelID?: string;
  outputTokens: number;
  providerID?: string;
}): Extract<OpenCodeMessage, { role: "assistant" }> {
  return {
    agent: "build",
    cost: input.cost,
    id: input.id,
    mode: "build",
    modelID: input.modelID ?? "gpt-5",
    parentID: "u1",
    path: {
      cwd: "/workspace",
      root: "/workspace",
    },
    providerID: input.providerID ?? "openai",
    role: "assistant",
    sessionID: "ses_test",
    time: {
      created: 2,
    },
    tokens: {
      input: input.inputTokens,
      output: input.outputTokens,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  };
}

const OpenCodeProviders: readonly OpenCodeProviderSummary[] = [
  {
    id: "openai",
    name: "OpenAI",
    source: "api",
    env: [],
    options: {},
    models: {
      "gpt-5": {
        id: "gpt-5",
        providerID: "openai",
        api: {
          id: "gpt-5",
          npm: "@ai-sdk/openai",
          url: "https://api.openai.com/v1",
        },
        capabilities: {
          attachment: true,
          input: {
            audio: false,
            image: true,
            pdf: false,
            text: true,
            video: false,
          },
          interleaved: false,
          output: {
            audio: false,
            image: false,
            pdf: false,
            text: true,
            video: false,
          },
          reasoning: true,
          temperature: true,
          toolcall: true,
        },
        cost: {
          cache: {
            read: 0,
            write: 0,
          },
          input: 1,
          output: 1,
        },
        headers: {},
        limit: {
          context: 1_000,
          output: 16_000,
        },
        name: "GPT-5",
        options: {},
        release_date: "2026-01-01",
        status: "active",
      },
    },
  },
];

describe("formatOpenCodeContextUsage", () => {
  it("formats context usage from the latest assistant message with tokens and total cost", () => {
    expect(
      formatOpenCodeContextUsage({
        chatState: createChatState([
          createUserMessage("u1"),
          createAssistantMessage({
            cost: 0.5,
            id: "a1",
            inputTokens: 0,
            outputTokens: 0,
          }),
          createAssistantMessage({
            cost: 1.25,
            id: "a2",
            inputTokens: 300,
            outputTokens: 100,
          }),
        ]),
        providers: OpenCodeProviders,
      }),
    ).toEqual({
      label: "Context 40% used",
      title: "400 used of 1,000 window, $1.75 total cost",
    });
  });

  it("falls back to token count when provider model context is unavailable", () => {
    expect(
      formatOpenCodeContextUsage({
        chatState: createChatState([
          createAssistantMessage({
            cost: 0.1,
            id: "a1",
            inputTokens: 40,
            modelID: "unknown",
            outputTokens: 10,
          }),
        ]),
        providers: OpenCodeProviders,
      }),
    ).toEqual({
      label: "Context 50 tokens",
      title: "50 tokens used, $0.10 total cost",
    });
  });

  it("still exposes cost when no assistant message has token usage", () => {
    expect(
      formatOpenCodeContextUsage({
        chatState: createChatState([
          createAssistantMessage({
            cost: 0.5,
            id: "a1",
            inputTokens: 0,
            outputTokens: 0,
          }),
        ]),
        providers: OpenCodeProviders,
      }),
    ).toEqual({
      label: "Cost $0.50",
      title: "$0.50 total cost",
    });
  });
});
