import { randomUUID } from "node:crypto";

import {
  AgentStreamClient,
  CodexJsonRpcClient,
  createNodeCodexSessionRuntime,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { systemSleeper } from "@mistle/time";
import { z } from "zod";

import { CodexConversationProviderInitializeClientInfo } from "../../../packages/integrations-definitions/src/agent-runtimes/codex/initialize-client-info.js";
import { ExecStreamClient } from "../../../packages/sandbox-session-client/src/exec-stream-client.js";
import { createNodeSandboxSessionRuntime } from "../../../packages/sandbox-session-client/src/node.js";
import { PtyStreamClient } from "../../../packages/sandbox-session-client/src/pty-stream-client.js";
import { SandboxSessionTransport } from "../../../packages/sandbox-session-client/src/transport.js";
import type { AuthenticatedSession, SystemTestFixture } from "../system-test-context.js";

const OPENAI_TARGET_KEY = "openai-default";
const OPENAI_CONNECTION_METHOD_ID = "api-key";
const OPENAI_API_KEY = "sk-system-sandbox-restart";
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

const StopSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

const ResumeSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

const SandboxdFaultInjectionAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    component: z.literal("egress_proxy"),
    action: z.literal("kill"),
  })
  .strict();

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
    observed_at: z.string().min(1),
    snapshot: z
      .object({
        observed_at: z.string().min(1),
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
    init_error: z.string().nullable(),
  })
  .strict();

export type SandboxdHealthResponse = z.infer<typeof SandboxdHealthResponseSchema>;

export type ConnectedCodexAgentSession = {
  close: () => Promise<void>;
  rpcClient: CodexJsonRpcClient;
  sessionClient: AgentStreamClient;
};

export type SandboxExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

const InternalAuthServiceTokenHeader = "x-mistle-service-token";

export async function prepareCodexSandbox(input: {
  fixture: SystemTestFixture;
  email: string;
}): Promise<{ authenticatedSession: AuthenticatedSession; sandboxInstanceId: string }> {
  const authenticatedSession = await input.fixture.authSession({
    email: input.email,
  });
  const openAiConnectionId = await createOpenAiConnection({
    fixture: input.fixture,
    authenticatedSession,
  });
  const sandboxProfileId = await createSandboxProfile({
    fixture: input.fixture,
    authenticatedSession,
  });
  await updateSandboxBindings({
    fixture: input.fixture,
    authenticatedSession,
    sandboxProfileId,
    openAiConnectionId,
  });

  const sandboxInstanceId = await startSandboxInstance({
    fixture: input.fixture,
    authenticatedSession,
    sandboxProfileId,
  });
  await waitForSandboxReady({
    fixture: input.fixture,
    authenticatedSession,
    sandboxInstanceId,
  });

  return {
    authenticatedSession,
    sandboxInstanceId,
  };
}

export async function mintSandboxConnectionUrl(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<string> {
  const connectionToken = await requestJsonOrThrow({
    request: input.fixture.request,
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
    gatewayBaseUrl: input.fixture.dataPlaneGatewayBaseUrl,
  });
}

export async function connectCodexAgentSession(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<ConnectedCodexAgentSession> {
  const connectionUrl = await mintSandboxConnectionUrl(input);
  const transport = new SandboxSessionTransport({
    runtime: createNodeCodexSessionRuntime(),
  });
  const sessionClient = new AgentStreamClient({
    transport,
  });

  await transport.connect({
    connectionUrl,
  });
  await sessionClient.connect();

  const rpcClient = new CodexJsonRpcClient(sessionClient);
  sessionClient.markInitializing();
  await rpcClient.call("initialize", {
    clientInfo: CodexConversationProviderInitializeClientInfo,
  });
  await rpcClient.notify("initialized", {});
  sessionClient.markReady();

  return {
    rpcClient,
    sessionClient,
    close: async () => {
      sessionClient.disconnect();
      transport.disconnect(1000, "system test cleanup");
    },
  };
}

export async function killRawCodexAppServer(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<void> {
  const connectionUrl = await mintSandboxConnectionUrl(input);
  const result = await runSandboxExecCommand({
    connectionUrl,
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
  if (result.exitCode !== 0 || !result.stdout.includes("killed:")) {
    throw new Error(
      `raw Codex app-server kill failed with exit code ${String(result.exitCode)}. stdout=${result.stdout} stderr=${result.stderr}`,
    );
  }
}

export async function runSandboxExecCommandInSandbox(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}): Promise<SandboxExecResult> {
  const connectionUrl = await mintSandboxConnectionUrl({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  return runSandboxExecCommand({
    connectionUrl,
    command: input.command,
    ...(input.args === undefined ? {} : { args: input.args }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
}

export async function triggerSandboxdEgressProxyKill(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<z.infer<typeof SandboxdFaultInjectionAcceptedResponseSchema>> {
  const result = await runSandboxExecCommandInSandbox({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command: "curl",
    args: ["-fsS", "-X", "POST", "http://127.0.0.1:3901/__faults/components/egress-proxy/kill"],
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `sandboxd egress proxy kill failed with exit code ${String(result.exitCode)}. stdout=${result.stdout} stderr=${result.stderr}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `sandboxd egress proxy kill returned invalid JSON: ${error instanceof Error ? error.message : String(error)}. stdout=${result.stdout}`,
    );
  }

  return SandboxdFaultInjectionAcceptedResponseSchema.parse(parsed);
}

export async function readSandboxHealthz(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<SandboxdHealthResponse> {
  const result = await runSandboxPtyCommand({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command: "curl",
    args: ["-fsS", "http://127.0.0.1:3901/__healthz"],
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `sandboxd __healthz command failed with exit code ${String(result.exitCode)}. output=${result.output}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.output);
  } catch (error) {
    throw new Error(
      `sandboxd __healthz returned invalid JSON: ${error instanceof Error ? error.message : String(error)}. output=${result.output}`,
    );
  }

  return SandboxdHealthResponseSchema.parse(parsed);
}

export async function waitForRuntimeReadyValue(input: {
  fixture: SystemTestFixture;
  sandboxInstanceId: string;
  expectedReady: boolean;
  timeoutMs: number;
}): Promise<void> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;

  while (true) {
    const snapshot = await input.fixture.readSandboxRuntimeState(input.sandboxInstanceId);
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

export async function waitForSandboxStatus(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
  expectedStatus: z.infer<typeof SandboxInstanceStatusResponseSchema>["status"];
}): Promise<z.infer<typeof SandboxInstanceStatusResponseSchema>> {
  return waitForCondition({
    description: `sandbox '${input.sandboxInstanceId}' status=${input.expectedStatus}`,
    timeoutMs: SANDBOX_READY_TIMEOUT_MS,
    evaluate: async () => {
      const response = await input.fixture.request(
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
      return sandboxStatus.status === input.expectedStatus ? sandboxStatus : null;
    },
  });
}

export async function waitForSandboxConnectable(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
  expectedConnectable: boolean;
}): Promise<z.infer<typeof SandboxInstanceStatusResponseSchema>> {
  return waitForCondition({
    description: `sandbox '${input.sandboxInstanceId}' connectable=${String(input.expectedConnectable)}`,
    timeoutMs: SANDBOX_READY_TIMEOUT_MS,
    evaluate: async () => {
      const response = await input.fixture.request(
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
          `sandbox connectable lookup failed with status ${String(response.status)}. Response body: ${bodyText}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch (error) {
        throw new Error(
          `sandbox connectable lookup returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const sandboxStatus = SandboxInstanceStatusResponseSchema.parse(parsed);
      return sandboxStatus.connectable === input.expectedConnectable ? sandboxStatus : null;
    },
  });
}

export async function stopSandboxInstance(input: {
  fixture: SystemTestFixture;
  sandboxInstanceId: string;
}): Promise<void> {
  const runtimeState = await input.fixture.readSandboxRuntimeState(input.sandboxInstanceId);
  const ownerLeaseId = runtimeState.attachment?.ownerLeaseId;
  if (ownerLeaseId === undefined) {
    throw new Error(
      `Sandbox '${input.sandboxInstanceId}' has no attachment owner lease id; stop requires an attached runtime owner.`,
    );
  }

  await requestJsonOrThrow({
    request: async (path, init) => fetch(`${input.fixture.dataPlaneApiBaseUrl}${path}`, init),
    path: `/internal/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/stop`,
    expectedStatus: 200,
    description: "internal sandbox stop",
    schema: StopSandboxInstanceAcceptedResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [InternalAuthServiceTokenHeader]: input.fixture.internalAuthServiceToken,
      },
      body: JSON.stringify({
        stopReason: "idle",
        expectedOwnerLeaseId: ownerLeaseId,
        idempotencyKey: `system-stop-${randomUUID()}`,
      }),
    },
  });
}

export async function resumeSandboxInstance(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<void> {
  await requestJsonOrThrow({
    request: async (path, init) => fetch(`${input.fixture.dataPlaneApiBaseUrl}${path}`, init),
    path: `/internal/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/resume`,
    expectedStatus: 200,
    description: "internal sandbox resume",
    schema: ResumeSandboxInstanceAcceptedResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [InternalAuthServiceTokenHeader]: input.fixture.internalAuthServiceToken,
      },
      body: JSON.stringify({
        organizationId: input.authenticatedSession.organizationId,
        idempotencyKey: `system-resume-${randomUUID()}`,
      }),
    },
  });
}

export async function waitForCondition<T>(input: {
  description: string;
  timeoutMs: number;
  pollIntervalMs?: number;
  evaluate: () => Promise<T | null>;
}): Promise<T> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;
  const pollIntervalMs = input.pollIntervalMs ?? POLL_INTERVAL_MS;

  while (true) {
    const result = await input.evaluate();
    if (result !== null) {
      return result;
    }

    const remainingMs = deadlineEpochMs - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Timed out waiting for ${input.description}.`);
    }

    await systemSleeper.sleep(Math.min(pollIntervalMs, remainingMs));
  }
}

async function createOpenAiConnection(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
}): Promise<string> {
  const connection = await requestJsonOrThrow({
    request: input.fixture.request,
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
        displayName: `System Codex Sandbox OpenAI ${randomUUID()}`,
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
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
}): Promise<string> {
  const sandboxProfile = await requestJsonOrThrow({
    request: input.fixture.request,
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
        displayName: `System Codex Sandbox ${randomUUID()}`,
      }),
    },
  });

  return sandboxProfile.id;
}

async function updateSandboxBindings(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxProfileId: string;
  openAiConnectionId: string;
}): Promise<void> {
  await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/sandbox/profiles/${encodeURIComponent(input.sandboxProfileId)}/versions/1/integration-bindings`,
    expectedStatus: 200,
    description: "sandbox profile integration binding update",
    schema: SandboxBindingsResponseSchema,
    init: {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: input.authenticatedSession.cookie,
      },
      body: JSON.stringify({
        bindings: [
          {
            connectionId: input.openAiConnectionId,
            kind: "agent",
            config: {
              runtime: {
                runtimeId: "codex",
                config: {},
              },
              model: {
                defaultModel: "gpt-5.3-codex",
                options: {
                  reasoningEffort: "medium",
                },
              },
            },
          },
        ],
      }),
    },
  });
}

async function startSandboxInstance(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxProfileId: string;
}): Promise<string> {
  const startedInstance = await requestJsonOrThrow({
    request: input.fixture.request,
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
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<void> {
  await waitForCondition({
    description: `sandbox '${input.sandboxInstanceId}' to reach running/connectable`,
    timeoutMs: SANDBOX_READY_TIMEOUT_MS,
    evaluate: async () => {
      const response = await input.fixture.request(
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
      const snapshot = await input.fixture.readSandboxRuntimeState(input.sandboxInstanceId);
      return snapshot.attachment !== null && snapshot.runtime.ready ? snapshot : null;
    },
  });
}

async function runSandboxExecCommand(input: {
  connectionUrl: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}): Promise<SandboxExecResult> {
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

async function runSandboxPtyCommand(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}): Promise<{ exitCode: number; output: string }> {
  const connectionUrl = await mintSandboxConnectionUrl({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });

  await transport.connect({
    connectionUrl,
  });

  try {
    const ptyClient = new PtyStreamClient({
      transport,
    });
    let output = "";

    ptyClient.onData((chunk) => {
      output += Buffer.from(chunk).toString("utf8");
    });

    await ptyClient.connect();
    await ptyClient.open({
      ptySessionId: "terminal",
      cols: 120,
      rows: 40,
      cwd: input.cwd ?? "/root",
      command: input.command,
      ...(input.args === undefined ? {} : { args: input.args }),
    });

    const exit = await new Promise<{ exitCode: number }>((resolve, reject) => {
      const timeoutSignal = AbortSignal.timeout(input.timeoutMs ?? 30_000);
      const removeExitListener = ptyClient.onExit((exitInfo) => {
        cleanup();
        resolve({
          exitCode: exitInfo.exitCode,
        });
      });
      const removeErrorListener = ptyClient.onError((error) => {
        cleanup();
        reject(error);
      });
      const removeResetListener = ptyClient.onReset((resetInfo) => {
        cleanup();
        reject(new Error(`Sandbox PTY reset (${resetInfo.code}): ${resetInfo.message}`));
      });

      const onTimeout = (): void => {
        cleanup();
        reject(
          new Error(
            `Timed out after ${String(input.timeoutMs ?? 30_000)}ms waiting for PTY command exit.`,
          ),
        );
      };

      const cleanup = (): void => {
        removeExitListener();
        removeErrorListener();
        removeResetListener();
        timeoutSignal.removeEventListener("abort", onTimeout);
      };

      timeoutSignal.addEventListener("abort", onTimeout, { once: true });
    });

    return {
      exitCode: exit.exitCode,
      output,
    };
  } finally {
    transport.disconnect(1000, "system test pty cleanup");
  }
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
