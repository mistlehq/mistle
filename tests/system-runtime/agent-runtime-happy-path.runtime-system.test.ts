/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { randomUUID } from "node:crypto";

import {
  readCodexThread,
  startCodexThread,
  startCodexTurn,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { createOpenCodeSessionClient } from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import { createPiSessionClient } from "@mistle/integrations-definitions/agent-runtimes/pi/client";
import { describe } from "vitest";

import { createNodeSandboxSessionRuntime } from "../../packages/sandbox-session-client/src/node.js";
import { SandboxSessionTransport } from "../../packages/sandbox-session-client/src/transport.js";
import {
  connectCodexAgentSession,
  mintSandboxConnectionUrl,
  prepareAgentRuntimeSandbox,
  waitForCondition,
  type CodexSandboxFixture,
  type SystemAgentRuntimeId,
} from "../system/helpers/codex-sandbox.js";
import { createRuntimeCodexSandboxFixture } from "./helpers/runtime-codex-sandbox.js";
import { createSandboxSystemTest } from "./helpers/sandbox-system-test.js";
import { timeSystemRuntimePhase } from "./helpers/system-runtime-phase-timing.js";

type AgentRuntimeHappyPathCase = {
  runtimeId: SystemAgentRuntimeId;
  email: string;
};

const AgentRuntimeHappyPathCases: readonly AgentRuntimeHappyPathCase[] = [
  {
    runtimeId: "codex",
    email: "agent-runtime-happy-path-codex@example.com",
  },
  {
    runtimeId: "opencode",
    email: "agent-runtime-happy-path-opencode@example.com",
  },
  {
    runtimeId: "pi",
    email: "agent-runtime-happy-path-pi@example.com",
  },
];

const it = createSandboxSystemTest({
  extraInfra: ["mailpit"],
  sandboxProviders: ["docker"],
  publicAccess: {
    provider: "cloudflare",
    services: ["data-plane-gateway"],
  },
});

const SystemTestTimeoutMs = 10 * 60_000;
const AgentResponseTimeoutMs = 3 * 60_000;
const OpenCodeZenFreeModel = {
  providerID: "opencode",
  modelID: "deepseek-v4-flash-free",
};

describe("runtime system agent runtime happy path", () => {
  for (const testCase of AgentRuntimeHappyPathCases) {
    it(
      `starts a sandbox and completes a direct conversation with ${testCase.runtimeId}`,
      async ({ sandboxProvider, system }) => {
        const fixture = createRuntimeCodexSandboxFixture(system);
        const responseMarker = `mistle-agent-runtime-${testCase.runtimeId}-${randomUUID()}`;
        const prompt = `Reply exactly with this marker and no other text: ${responseMarker}`;
        const attributes = {
          sandboxProvider,
          agentRuntimeId: testCase.runtimeId,
        };

        const { authenticatedSession, sandboxInstanceId } = await timeSystemRuntimePhase({
          event: "system_runtime.agent_runtime_happy_path.phase_timing",
          phase: "prepare_sandbox",
          attributes,
          operation: async () =>
            await prepareAgentRuntimeSandbox({
              fixture,
              agentRuntimeId: testCase.runtimeId,
              ...(testCase.runtimeId === "opencode" ? {} : { openAiApiKey: requireOpenAiApiKey() }),
              email: testCase.email,
            }),
        });

        await timeSystemRuntimePhase({
          event: "system_runtime.agent_runtime_happy_path.phase_timing",
          phase: "complete_conversation",
          attributes,
          operation: async () => {
            switch (testCase.runtimeId) {
              case "codex":
                await completeCodexConversation({
                  fixture,
                  authenticatedSession,
                  sandboxInstanceId,
                  prompt,
                  responseMarker,
                });
                return;
              case "opencode":
                await completeOpenCodeConversation({
                  fixture,
                  authenticatedSession,
                  sandboxInstanceId,
                  prompt,
                  responseMarker,
                });
                return;
              case "pi":
                await completePiConversation({
                  fixture,
                  authenticatedSession,
                  sandboxInstanceId,
                  prompt,
                  responseMarker,
                });
                return;
            }
          },
        });
      },
      SystemTestTimeoutMs,
    );
  }
});

function requireOpenAiApiKey(): string {
  const apiKey = process.env.MISTLE_TEST_OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("MISTLE_TEST_OPENAI_API_KEY is required for agent runtime happy path tests.");
  }
  return apiKey;
}

async function completeCodexConversation(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: { cookie: string; organizationId: string; userId: string };
  sandboxInstanceId: string;
  prompt: string;
  responseMarker: string;
}): Promise<void> {
  const attachedAgentSession = await connectCodexAgentSession(input);
  try {
    const thread = await startCodexThread({
      rpcClient: attachedAgentSession.rpcClient,
    });
    const turn = await startCodexTurn({
      rpcClient: attachedAgentSession.rpcClient,
      threadId: thread.threadId,
      input: [
        {
          type: "text",
          text: input.prompt,
        },
      ],
    });

    await waitForCondition({
      description: `Codex assistant message containing '${input.responseMarker}'`,
      timeoutMs: AgentResponseTimeoutMs,
      evaluate: async () => {
        const threadRead = await readCodexThread({
          rpcClient: attachedAgentSession.rpcClient,
          threadId: thread.threadId,
        });
        const targetTurn = threadRead.turns.find((candidate) => candidate.id === turn.turnId);
        if (targetTurn?.status === "failed") {
          throw new Error(`Codex turn '${turn.turnId}' failed.`);
        }
        if (targetTurn?.status !== "completed") {
          return null;
        }
        return collectCodexAssistantTexts(threadRead.response).some((text) =>
          text.includes(input.responseMarker),
        )
          ? true
          : null;
      },
    });
  } finally {
    await attachedAgentSession.close();
  }
}

async function completeOpenCodeConversation(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: { cookie: string; organizationId: string; userId: string };
  sandboxInstanceId: string;
  prompt: string;
  responseMarker: string;
}): Promise<void> {
  const connectionUrl = await mintSandboxConnectionUrl(input);
  const transport = createSandboxSessionTransport(input.fixture);
  await transport.connect({
    connectionUrl,
  });
  const client = createOpenCodeSessionClient({
    transport,
  });
  try {
    const session = await client.createSession({
      model: {
        providerID: OpenCodeZenFreeModel.providerID,
        id: OpenCodeZenFreeModel.modelID,
      },
    });
    await client.sendPrompt({
      sessionId: session.id,
      model: OpenCodeZenFreeModel,
      parts: [
        {
          type: "text",
          text: input.prompt,
        },
      ],
    });

    await waitForCondition({
      description: `OpenCode assistant message containing '${input.responseMarker}'`,
      timeoutMs: AgentResponseTimeoutMs,
      evaluate: async () => {
        const sessionStatuses = await client.listSessionStatuses();
        const status = sessionStatuses[session.id];
        if (status?.type === "busy" || status?.type === "retry") {
          return null;
        }
        const messages = await client.listMessages({
          sessionId: session.id,
        });
        return messages.some((message) =>
          nonUserMessageContainsString(message, input.responseMarker),
        )
          ? true
          : null;
      },
    });
  } finally {
    client.close();
    transport.disconnect(1000, "agent runtime happy path OpenCode cleanup");
  }
}

async function completePiConversation(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: { cookie: string; organizationId: string; userId: string };
  sandboxInstanceId: string;
  prompt: string;
  responseMarker: string;
}): Promise<void> {
  const connectionUrl = await mintSandboxConnectionUrl(input);
  const transport = createSandboxSessionTransport(input.fixture);
  await transport.connect({
    connectionUrl,
  });
  const client = createPiSessionClient({
    transport,
  });
  try {
    await client.connect();
    const conversation = await client.createConversation({});
    await client.prompt({
      sessionFile: conversation.sessionFile,
      message: input.prompt,
    });

    await waitForCondition({
      description: `Pi assistant message containing '${input.responseMarker}'`,
      timeoutMs: AgentResponseTimeoutMs,
      evaluate: async () => {
        const state = await client.getState({
          sessionFile: conversation.sessionFile,
        });
        if (state.isStreaming || state.isCompacting || state.pendingMessageCount > 0) {
          return null;
        }
        const messages = await client.getMessages({
          sessionFile: conversation.sessionFile,
        });
        return messages.some((message) =>
          nonUserMessageContainsString(message, input.responseMarker),
        )
          ? true
          : null;
      },
    });
  } finally {
    client.close();
    transport.disconnect(1000, "agent runtime happy path Pi cleanup");
  }
}

function createSandboxSessionTransport(fixture: CodexSandboxFixture): SandboxSessionTransport {
  return new SandboxSessionTransport({
    runtime: fixture.createSessionRuntime?.() ?? createNodeSandboxSessionRuntime(),
    connectTimeoutMs: 120_000,
  });
}

function collectCodexAssistantTexts(threadReadResult: unknown): string[] {
  const assistantTexts: string[] = [];
  if (!isRecord(threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }
  const thread = threadReadResult.thread;
  if (!isRecord(thread) || !Array.isArray(thread.turns)) {
    throw new Error("thread/read result.thread.turns must be an array.");
  }

  for (const turn of thread.turns) {
    if (!isRecord(turn) || !Array.isArray(turn.items)) {
      continue;
    }
    for (const item of turn.items) {
      if (!isRecord(item) || item.type !== "assistantMessage" || !Array.isArray(item.content)) {
        continue;
      }
      for (const contentItem of item.content) {
        if (
          isRecord(contentItem) &&
          contentItem.type === "text" &&
          typeof contentItem.text === "string"
        ) {
          assistantTexts.push(contentItem.text);
        }
      }
    }
  }

  return assistantTexts;
}

function unknownContainsString(value: unknown, expectedSubstring: string): boolean {
  if (typeof value === "string") {
    return value.includes(expectedSubstring);
  }
  if (Array.isArray(value)) {
    return value.some((item) => unknownContainsString(item, expectedSubstring));
  }
  if (isRecord(value)) {
    return Object.values(value).some((item) => unknownContainsString(item, expectedSubstring));
  }
  return false;
}

function nonUserMessageContainsString(value: unknown, expectedSubstring: string): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.role === "user") {
    return false;
  }
  const info = value.info;
  if (isRecord(info) && info.role === "user") {
    return false;
  }
  return unknownContainsString(value, expectedSubstring);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
