/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import {
  AgentStreamClient,
  CodexJsonRpcClient,
  createNodeCodexSessionRuntime,
  buildCodexTurnInputItems,
  readCodexThread,
  resumeCodexThread,
  startCodexThread,
  startCodexTurn,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  CodexConversationProviderInitializeClientInfo,
  CodexDashboardInitializeClientInfo,
} from "../../packages/integrations-definitions/src/agent-runtimes/codex/initialize-client-info.js";
import { ExecStreamClient } from "../../packages/sandbox-session-client/src/exec-stream-client.js";
import { createNodeSandboxSessionRuntime } from "../../packages/sandbox-session-client/src/node.js";
import { SandboxSessionTransport } from "../../packages/sandbox-session-client/src/transport.js";
import { it } from "./system-test-context.js";

const OPENAI_TARGET_KEY = "openai-default";
const OPENAI_CONNECTION_METHOD_ID = "api-key";
const OPENAI_API_KEY_ENV_NAME = "MISTLE_TEST_OPENAI_API_KEY";
const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;
const SANDBOX_READY_TIMEOUT_MS = 3 * 60_000;
const TURN_TERMINAL_TIMEOUT_MS = 2 * 60_000;
const MARKER_FILE_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;

const IntegrationConnectionResponseSchema = z.looseObject({
  id: z.string().min(1),
});

const SandboxProfileResponseSchema = z.looseObject({
  id: z.string().min(1),
});

const SandboxBindingsResponseSchema = z.object({
  bindings: z.array(z.unknown()),
});

const SandboxProfileVersionDraftBindingsResponseSchema = z.object({
  integrationBindings: SandboxBindingsResponseSchema,
});

const StartSandboxInstanceResponseSchema = z.looseObject({
  status: z.literal("accepted"),
  workflowRunId: z.string().min(1),
  sandboxInstanceId: z.string().min(1),
});

const SandboxInstanceStatusResponseSchema = z.looseObject({
  id: z.string().min(1),
  status: z.enum(SandboxInstanceStatuses),
  connectable: z.boolean(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
});

const SandboxInstanceConnectionTokenResponseSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

type AuthenticatedSession = {
  cookie: string;
  organizationId: string;
  userId: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function requestJsonOrThrow<TSchema extends z.ZodType>(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  path: string;
  init: RequestInit;
  expectedStatus: number;
  description: string;
  schema: TSchema;
}): Promise<z.infer<TSchema>> {
  const response = await input.request(input.path, input.init);
  const bodyText = await response.text().catch(() => "");

  if (response.status !== input.expectedStatus) {
    throw new Error(
      `${input.description} expected status ${String(input.expectedStatus)}, got ${String(response.status)}. Response body: ${bodyText}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    throw new Error(
      `${input.description} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return input.schema.parse(parsed);
}

function resolveGatewayWebSocketUrl(input: { mintedUrl: string; gatewayBaseUrl: string }): string {
  const mintedUrl = new URL(input.mintedUrl);
  const gatewayBaseUrl = new URL(input.gatewayBaseUrl);

  if (gatewayBaseUrl.protocol === "http:") {
    mintedUrl.protocol = "ws:";
  } else if (gatewayBaseUrl.protocol === "https:") {
    mintedUrl.protocol = "wss:";
  } else {
    throw new Error(`Unsupported data plane gateway protocol '${gatewayBaseUrl.protocol}'.`);
  }

  mintedUrl.hostname = gatewayBaseUrl.hostname;
  mintedUrl.port = gatewayBaseUrl.port;

  return mintedUrl.toString();
}

function shellQuote(input: string): string {
  return `'${input.replaceAll("'", `'\\''`)}'`;
}

async function waitForCondition<T>(input: {
  description: string;
  timeoutMs: number;
  evaluate: () => Promise<T | null>;
}): Promise<T> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;

  while (true) {
    const result = await input.evaluate();
    if (result !== null) {
      return result;
    }

    const remainingMs = deadlineEpochMs - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Timed out waiting for ${input.description}.`);
    }

    await systemSleeper.sleep(Math.min(POLL_INTERVAL_MS, remainingMs));
  }
}

async function createOpenAiConnection(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  openAiApiKey: string;
}): Promise<string> {
  const connection = await requestJsonOrThrow({
    request: input.request,
    path: `/v1/integration/connections/${encodeURIComponent(OPENAI_TARGET_KEY)}/form`,
    expectedStatus: 201,
    description: "OpenAI form connection creation",
    schema: IntegrationConnectionResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: `Disconnect Survival OpenAI ${randomUUID()}`,
        methodId: OPENAI_CONNECTION_METHOD_ID,
        config: {
          connection_method: OPENAI_CONNECTION_METHOD_ID,
        },
        secrets: {
          apiKey: input.openAiApiKey,
        },
      }),
    },
  });

  return connection.id;
}

async function createSandboxProfile(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
}): Promise<string> {
  const sandboxProfile = await requestJsonOrThrow({
    request: input.request,
    path: "/v1/sandbox/profiles",
    expectedStatus: 201,
    description: "sandbox profile creation",
    schema: SandboxProfileResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: `Disconnect Survival Sandbox ${randomUUID()}`,
      }),
    },
  });

  return sandboxProfile.id;
}

async function updateSandboxBindings(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  sandboxProfileId: string;
  openAiConnectionId: string;
}): Promise<void> {
  await requestJsonOrThrow({
    request: input.request,
    path: `/v1/sandbox/profiles/${encodeURIComponent(input.sandboxProfileId)}/versions/1/draft`,
    expectedStatus: 200,
    description: "sandbox profile integration binding update",
    schema: SandboxProfileVersionDraftBindingsResponseSchema,
    init: {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: input.authenticatedSession.cookie,
      },
      body: JSON.stringify({
        integrationBindings: {
          bindings: [
            {
              connectionId: input.openAiConnectionId,
              kind: "agent",
              config: {},
            },
          ],
        },
      }),
    },
  });
}

async function startSandboxInstance(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  sandboxProfileId: string;
}): Promise<string> {
  const startedInstance = await requestJsonOrThrow({
    request: input.request,
    path: `/v1/sandbox/profiles/${encodeURIComponent(input.sandboxProfileId)}/versions/1/instances`,
    expectedStatus: 201,
    description: "sandbox profile start instance",
    schema: StartSandboxInstanceResponseSchema,
    init: {
      method: "POST",
      headers: {
        cookie: input.authenticatedSession.cookie,
      },
    },
  });

  return startedInstance.sandboxInstanceId;
}

async function waitForSandboxReady(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  readSandboxRuntimeState: (sandboxInstanceId: string) => Promise<{
    attachment: object | null;
    runtime: {
      ready: boolean;
    };
  }>;
  sandboxInstanceId: string;
}): Promise<void> {
  await waitForCondition({
    description: `sandbox '${input.sandboxInstanceId}' to reach running/connectable`,
    timeoutMs: SANDBOX_READY_TIMEOUT_MS,
    evaluate: async () => {
      const response = await input.request(
        `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}`,
        {
          headers: {
            cookie: input.authenticatedSession.cookie,
          },
        },
      );
      const bodyText = await response.text().catch(() => "");
      if (response.status !== 200) {
        throw new Error(
          `sandbox status lookup failed with status ${String(response.status)}. Response body: ${bodyText}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch (error) {
        throw new Error(
          `sandbox status lookup returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const sandboxStatus = SandboxInstanceStatusResponseSchema.parse(parsed);
      if (sandboxStatus.status === "failed" || sandboxStatus.status === "stopped") {
        throw new Error(
          `Sandbox '${sandboxStatus.id}' entered terminal status '${sandboxStatus.status}': ${sandboxStatus.failureMessage ?? "no failure message"}`,
        );
      }

      return sandboxStatus.status === "running" && sandboxStatus.connectable ? sandboxStatus : null;
    },
  });

  await waitForCondition({
    description: `sandbox '${input.sandboxInstanceId}' runtime readiness`,
    timeoutMs: SANDBOX_READY_TIMEOUT_MS,
    evaluate: async () => {
      const snapshot = await input.readSandboxRuntimeState(input.sandboxInstanceId);
      return snapshot.attachment !== null && snapshot.runtime.ready ? snapshot : null;
    },
  });
}

async function mintSandboxConnectionUrl(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  dataPlaneGatewayBaseUrl: string;
  sandboxInstanceId: string;
}): Promise<string> {
  const connectionToken = await requestJsonOrThrow({
    request: input.request,
    path: `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/connection-tokens`,
    expectedStatus: 201,
    description: "sandbox connection token minting",
    schema: SandboxInstanceConnectionTokenResponseSchema,
    init: {
      method: "POST",
      headers: {
        cookie: input.authenticatedSession.cookie,
      },
    },
  });

  return resolveGatewayWebSocketUrl({
    mintedUrl: connectionToken.url,
    gatewayBaseUrl: input.dataPlaneGatewayBaseUrl,
  });
}

async function connectCodexSession(input: { connectionUrl: string }): Promise<{
  close: (input?: { code?: number; reason?: string }) => Promise<void>;
  rpcClient: CodexJsonRpcClient;
  sessionClient: AgentStreamClient;
}> {
  const transport = new SandboxSessionTransport({
    runtime: createNodeCodexSessionRuntime(),
  });
  const sessionClient = new AgentStreamClient({
    transport,
  });

  await transport.connect({
    connectionUrl: input.connectionUrl,
  });
  await sessionClient.connect();

  const rpcClient = new CodexJsonRpcClient(sessionClient);

  return {
    rpcClient,
    sessionClient,
    close: async (closeInput) => {
      sessionClient.disconnect();
      transport.disconnect(closeInput?.code ?? 1000, closeInput?.reason ?? "system test cleanup");
    },
  };
}

async function initializeCodexSession(input: {
  rpcClient: CodexJsonRpcClient;
  sessionClient: AgentStreamClient;
  clientInfo: {
    name: string;
    version: string;
    title?: string;
  };
}): Promise<void> {
  input.sessionClient.markInitializing();
  await input.rpcClient.call("initialize", {
    clientInfo: input.clientInfo,
  });
  await input.rpcClient.notify("initialized", {});
  input.sessionClient.markReady();
}

async function waitForTurnTerminalState(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  turnId: string;
  timeoutMs: number;
}): Promise<{
  status: string;
  items: readonly unknown[];
}> {
  return await waitForCondition({
    description: `turn '${input.turnId}' to reach a terminal status`,
    timeoutMs: input.timeoutMs,
    evaluate: async () => {
      const threadRead = await readCodexThread({
        rpcClient: input.rpcClient,
        threadId: input.threadId,
      });
      const turn = threadRead.turns.find((candidateTurn) => candidateTurn.id === input.turnId);
      if (turn === undefined || turn.status === null) {
        return null;
      }

      if (
        turn.status === "completed" ||
        turn.status === "failed" ||
        turn.status === "interrupted"
      ) {
        return {
          status: turn.status,
          items: turn.items,
        };
      }

      return null;
    },
  });
}

async function runSandboxExecCommand(input: {
  connectionUrl: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}> {
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });

  await transport.connect({
    connectionUrl: input.connectionUrl,
  });

  try {
    const execClient = new ExecStreamClient({
      transport,
    });

    return await execClient.run({
      command: input.command,
      ...(input.args === undefined ? {} : { args: input.args }),
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
  } finally {
    transport.disconnect(1000, "system test exec cleanup");
  }
}

async function runDisconnectSurvivalScenario(input: {
  fixture: {
    request: (path: string, init?: RequestInit) => Promise<Response>;
    dataPlaneGatewayBaseUrl: string;
  };
  authenticatedSession: {
    cookie: string;
    organizationId: string;
    userId: string;
  };
  sandboxInstanceId: string;
  clientInfo: {
    name: string;
    version: string;
    title?: string;
  };
  markerPrefix: string;
}): Promise<void> {
  const marker = `${input.markerPrefix}-${randomUUID()}`;
  const markerDirectory = "/tmp/mistle-system-tests";
  const markerFilePath = `${markerDirectory}/${marker}.txt`;
  const shellCommand = [
    "sh -lc",
    shellQuote(
      [
        "sleep 8",
        `mkdir -p ${shellQuote(markerDirectory)}`,
        `printf %s ${shellQuote(marker)} > ${shellQuote(markerFilePath)}`,
      ].join("; "),
    ),
  ].join(" ");

  const firstConnectionUrl = await mintSandboxConnectionUrl({
    request: input.fixture.request,
    authenticatedSession: input.authenticatedSession,
    dataPlaneGatewayBaseUrl: input.fixture.dataPlaneGatewayBaseUrl,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const firstAgentConnection = await connectCodexSession({
    connectionUrl: firstConnectionUrl,
  });

  let firstRpcClient: CodexJsonRpcClient | null = firstAgentConnection.rpcClient;

  try {
    await initializeCodexSession({
      rpcClient: firstRpcClient,
      sessionClient: firstAgentConnection.sessionClient,
      clientInfo: input.clientInfo,
    });

    const startedThread = await startCodexThread({
      rpcClient: firstRpcClient,
      model: "gpt-5.3-codex",
    });
    const startedTurn = await startCodexTurn({
      rpcClient: firstRpcClient,
      threadId: startedThread.threadId,
      input: buildCodexTurnInputItems({
        text: [
          "Use the shell tool and run exactly this command:",
          `\`${shellCommand}\``,
          `After the command succeeds, reply with exactly ${marker}.`,
          "Do not ask for confirmation and do not use any tool other than the shell tool.",
        ].join(" "),
        attachments: [],
      }),
    });

    expect(startedTurn.status).toBe("inProgress");

    firstRpcClient.dispose();
    firstRpcClient = null;
    await firstAgentConnection.close({
      reason: "system test disconnect after turn/start",
    });

    const secondConnectionUrl = await mintSandboxConnectionUrl({
      request: input.fixture.request,
      authenticatedSession: input.authenticatedSession,
      dataPlaneGatewayBaseUrl: input.fixture.dataPlaneGatewayBaseUrl,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const secondAgentConnection = await connectCodexSession({
      connectionUrl: secondConnectionUrl,
    });
    const secondRpcClient = secondAgentConnection.rpcClient;

    try {
      await initializeCodexSession({
        rpcClient: secondRpcClient,
        sessionClient: secondAgentConnection.sessionClient,
        clientInfo: input.clientInfo,
      });
      await resumeCodexThread({
        rpcClient: secondRpcClient,
        threadId: startedThread.threadId,
      });

      const completedTurn = await waitForTurnTerminalState({
        rpcClient: secondRpcClient,
        threadId: startedThread.threadId,
        turnId: startedTurn.turnId,
        timeoutMs: TURN_TERMINAL_TIMEOUT_MS,
      });

      expect(completedTurn.status).toBe("completed");
      expect(completedTurn.items.length).toBeGreaterThan(0);

      await waitForCondition({
        description: `marker file '${markerFilePath}' to exist in sandbox`,
        timeoutMs: MARKER_FILE_TIMEOUT_MS,
        evaluate: async () => {
          const execConnectionUrl = await mintSandboxConnectionUrl({
            request: input.fixture.request,
            authenticatedSession: input.authenticatedSession,
            dataPlaneGatewayBaseUrl: input.fixture.dataPlaneGatewayBaseUrl,
            sandboxInstanceId: input.sandboxInstanceId,
          });
          const result = await runSandboxExecCommand({
            connectionUrl: execConnectionUrl,
            command: "sh",
            args: [
              "-lc",
              `test -f ${shellQuote(markerFilePath)} && cat ${shellQuote(markerFilePath)}`,
            ],
            cwd: "/root",
            timeoutMs: 30_000,
          });

          if (result.exitCode !== 0) {
            return null;
          }

          return result.stdout.trim() === marker ? result : null;
        },
      });
    } finally {
      secondRpcClient.dispose();
      await secondAgentConnection.close({
        reason: "system test cleanup",
      });
    }
  } finally {
    if (firstRpcClient !== null) {
      firstRpcClient.dispose();
      await firstAgentConnection.close({
        reason: "system test cleanup",
      });
    }
  }
}

describe("system sandbox codex turn survives disconnect", () => {
  it(
    "keeps a codex turn running to completion after the only dashboard client disconnects",
    async ({ fixture }) => {
      const openAiApiKey = requireEnv(OPENAI_API_KEY_ENV_NAME);
      const authenticatedSession = await fixture.authSession({
        email: "sandbox-codex-dashboard-turn-survives-disconnect@example.com",
      });

      const openAiConnectionId = await createOpenAiConnection({
        request: fixture.request,
        authenticatedSession,
        openAiApiKey,
      });
      const sandboxProfileId = await createSandboxProfile({
        request: fixture.request,
        authenticatedSession,
      });
      await updateSandboxBindings({
        request: fixture.request,
        authenticatedSession,
        sandboxProfileId,
        openAiConnectionId,
      });

      const sandboxInstanceId = await startSandboxInstance({
        request: fixture.request,
        authenticatedSession,
        sandboxProfileId,
      });
      await waitForSandboxReady({
        request: fixture.request,
        authenticatedSession,
        readSandboxRuntimeState: fixture.readSandboxRuntimeState,
        sandboxInstanceId,
      });

      await runDisconnectSurvivalScenario({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
        clientInfo: CodexDashboardInitializeClientInfo,
        markerPrefix: "dashboard-disconnect-survives",
      });
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );

  it(
    "keeps a codex turn running to completion after the trigger conversation client disconnects",
    async ({ fixture }) => {
      const openAiApiKey = requireEnv(OPENAI_API_KEY_ENV_NAME);
      const authenticatedSession = await fixture.authSession({
        email: "sandbox-codex-worker-turn-survives-disconnect@example.com",
      });

      const openAiConnectionId = await createOpenAiConnection({
        request: fixture.request,
        authenticatedSession,
        openAiApiKey,
      });
      const sandboxProfileId = await createSandboxProfile({
        request: fixture.request,
        authenticatedSession,
      });
      await updateSandboxBindings({
        request: fixture.request,
        authenticatedSession,
        sandboxProfileId,
        openAiConnectionId,
      });

      const sandboxInstanceId = await startSandboxInstance({
        request: fixture.request,
        authenticatedSession,
        sandboxProfileId,
      });
      await waitForSandboxReady({
        request: fixture.request,
        authenticatedSession,
        readSandboxRuntimeState: fixture.readSandboxRuntimeState,
        sandboxInstanceId,
      });

      await runDisconnectSurvivalScenario({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
        clientInfo: CodexConversationProviderInitializeClientInfo,
        markerPrefix: "worker-disconnect-survives",
      });
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});
