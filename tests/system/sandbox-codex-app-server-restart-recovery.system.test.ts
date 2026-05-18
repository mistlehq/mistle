/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import {
  AgentStreamClient,
  CodexJsonRpcClient,
  createNodeCodexSessionRuntime,
  startCodexThread,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CodexConversationProviderInitializeClientInfo } from "../../packages/integrations-definitions/src/agent-runtimes/codex/initialize-client-info.js";
import { ExecStreamClient } from "../../packages/sandbox-session-client/src/exec-stream-client.js";
import { createNodeSandboxSessionRuntime } from "../../packages/sandbox-session-client/src/node.js";
import { SandboxSessionTransport } from "../../packages/sandbox-session-client/src/transport.js";
import { it, type AuthenticatedSession } from "./system-test-context.js";

const OPENAI_TARGET_KEY = "openai-default";
const OPENAI_CONNECTION_METHOD_ID = "api-key";
const OPENAI_API_KEY = "sk-system-sandbox-restart";
const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;
const SANDBOX_READY_TIMEOUT_MS = 3 * 60_000;
const POLL_INTERVAL_MS = 1_000;
const RUNTIME_READY_POLL_INTERVAL_MS = 100;

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
  status: z.enum(["pending", "starting", "running", "stopped", "failed"]),
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

const SandboxdHealthResponseSchema = z
  .object({
    daemon_phase: z.string().min(1),
    snapshot: z
      .object({
        components: z.array(
          z.object({
            component: z.string().min(1),
            state: z.string().min(1),
            restart_count: z.number().int().nonnegative(),
            last_error: z.string().nullable().optional(),
            details: z.record(z.string(), z.string()),
          }),
        ),
      })
      .nullable(),
  })
  .strict();

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

async function createOpenAiConnection(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
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
        displayName: `Restart Recovery OpenAI ${randomUUID()}`,
        methodId: OPENAI_CONNECTION_METHOD_ID,
        config: {
          connection_method: OPENAI_CONNECTION_METHOD_ID,
        },
        secrets: {
          apiKey: OPENAI_API_KEY,
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
        displayName: `Restart Recovery Sandbox ${randomUUID()}`,
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

async function waitForRuntimeReadyValue(input: {
  readSandboxRuntimeState: (sandboxInstanceId: string) => Promise<{
    runtime: {
      ready: boolean;
    };
  }>;
  sandboxInstanceId: string;
  expectedReady: boolean;
  timeoutMs: number;
}): Promise<void> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;

  while (true) {
    const snapshot = await input.readSandboxRuntimeState(input.sandboxInstanceId);
    if (snapshot.runtime.ready === input.expectedReady) {
      return;
    }

    const remainingMs = deadlineEpochMs - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `Timed out waiting for sandbox '${input.sandboxInstanceId}' runtime.ready=${String(input.expectedReady)}.`,
      );
    }

    await systemSleeper.sleep(Math.min(RUNTIME_READY_POLL_INTERVAL_MS, remainingMs));
  }
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
  close: () => Promise<void>;
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
    close: async () => {
      sessionClient.disconnect();
      transport.disconnect(1000, "system test cleanup");
    },
  };
}

async function initializeTriggerWorkerSession(input: {
  rpcClient: CodexJsonRpcClient;
  sessionClient: AgentStreamClient;
}): Promise<void> {
  input.sessionClient.markInitializing();
  await input.rpcClient.call("initialize", {
    clientInfo: CodexConversationProviderInitializeClientInfo,
  });
  await input.rpcClient.notify("initialized", {});
  input.sessionClient.markReady();
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

async function readSandboxHealthz(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  dataPlaneGatewayBaseUrl: string;
  sandboxInstanceId: string;
}): Promise<z.infer<typeof SandboxdHealthResponseSchema>> {
  const connectionUrl = await mintSandboxConnectionUrl(input);
  const result = await runSandboxExecCommand({
    connectionUrl,
    command: "curl",
    args: ["-fsS", "http://127.0.0.1:3901/__healthz"],
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `sandboxd __healthz command failed with exit code ${String(result.exitCode)}. stdout=${result.stdout} stderr=${result.stderr}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `sandboxd __healthz returned invalid JSON: ${error instanceof Error ? error.message : String(error)}. stdout=${result.stdout}`,
    );
  }

  return SandboxdHealthResponseSchema.parse(parsed);
}

describe("system sandbox codex app-server restart recovery", () => {
  it(
    "restarts the raw codex app-server and restores a usable agent session",
    async ({ fixture }) => {
      const authenticatedSession = await fixture.authSession({
        email: "sandbox-codex-app-server-restart-recovery@example.com",
      });
      const openAiConnectionId = await createOpenAiConnection({
        request: fixture.request,
        authenticatedSession,
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

      const preKillAgentConnectionUrl = await mintSandboxConnectionUrl({
        request: fixture.request,
        authenticatedSession,
        dataPlaneGatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
        sandboxInstanceId,
      });
      const preKillAgentConnection = await connectCodexSession({
        connectionUrl: preKillAgentConnectionUrl,
      });

      try {
        await initializeTriggerWorkerSession({
          rpcClient: preKillAgentConnection.rpcClient,
          sessionClient: preKillAgentConnection.sessionClient,
        });

        const killConnectionUrl = await mintSandboxConnectionUrl({
          request: fixture.request,
          authenticatedSession,
          dataPlaneGatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
          sandboxInstanceId,
        });
        const killResult = await runSandboxExecCommand({
          connectionUrl: killConnectionUrl,
          command: "sh",
          args: [
            "-lc",
            [
              'pid="$(ps -eo pid=,args= | awk \'$2 == "/usr/local/bin/codex" && $3 == "app-server" { print $1; exit }\' )"',
              'test -n "$pid"',
              'kill -9 "$pid"',
              'printf "killed:%s\\n" "$pid"',
            ].join("; "),
          ],
        });
        expect(killResult.exitCode).toBe(0);
        expect(killResult.stdout).toContain("killed:");

        await waitForRuntimeReadyValue({
          readSandboxRuntimeState: fixture.readSandboxRuntimeState,
          sandboxInstanceId,
          expectedReady: false,
          timeoutMs: 30_000,
        });
        try {
          await waitForRuntimeReadyValue({
            readSandboxRuntimeState: fixture.readSandboxRuntimeState,
            sandboxInstanceId,
            expectedReady: true,
            timeoutMs: SANDBOX_READY_TIMEOUT_MS,
          });
        } catch (error) {
          const runtimeState = await fixture
            .readSandboxRuntimeState(sandboxInstanceId)
            .catch(
              (runtimeStateError: unknown) =>
                `runtime-state read failed: ${
                  runtimeStateError instanceof Error
                    ? runtimeStateError.message
                    : String(runtimeStateError)
                }`,
            );
          const healthz = await readSandboxHealthz({
            request: fixture.request,
            authenticatedSession,
            dataPlaneGatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
            sandboxInstanceId,
          }).catch(
            (healthzError: unknown) =>
              `sandboxd healthz read failed: ${
                healthzError instanceof Error ? healthzError.message : String(healthzError)
              }`,
          );
          throw new Error(
            `Sandbox runtime readiness did not recover after raw Codex app-server kill. Runtime state: ${
              typeof runtimeState === "string" ? runtimeState : JSON.stringify(runtimeState)
            }. Healthz: ${typeof healthz === "string" ? healthz : JSON.stringify(healthz)}. Cause: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      } finally {
        await preKillAgentConnection.close().catch(() => {});
      }

      const recoveredConnectionUrl = await mintSandboxConnectionUrl({
        request: fixture.request,
        authenticatedSession,
        dataPlaneGatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
        sandboxInstanceId,
      });
      const recoveredAgentConnection = await connectCodexSession({
        connectionUrl: recoveredConnectionUrl,
      });

      try {
        await initializeTriggerWorkerSession({
          rpcClient: recoveredAgentConnection.rpcClient,
          sessionClient: recoveredAgentConnection.sessionClient,
        });

        const startedThread = await startCodexThread({
          rpcClient: recoveredAgentConnection.rpcClient,
          model: "gpt-5.3-codex",
        });
        expect(startedThread.threadId).toMatch(/^019/);
      } finally {
        await recoveredAgentConnection.close();
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});
