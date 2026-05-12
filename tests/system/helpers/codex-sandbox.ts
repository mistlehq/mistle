import { randomUUID } from "node:crypto";

import {
  AgentStreamClient,
  CodexJsonRpcClient,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { systemSleeper } from "@mistle/time";
import { z } from "zod";

import { CodexConversationProviderInitializeClientInfo } from "../../../packages/integrations-definitions/src/agent-runtimes/codex/initialize-client-info.js";
import type { SandboxRuntimeStateSnapshot } from "../../../packages/sandbox-runtime-contract/src/runtime-state.js";
import { ExecStreamClient } from "../../../packages/sandbox-session-client/src/exec-stream-client.js";
import { createNodeSandboxSessionRuntime } from "../../../packages/sandbox-session-client/src/node.js";
import { PtyStreamClient } from "../../../packages/sandbox-session-client/src/pty-stream-client.js";
import type { SandboxSessionRuntime } from "../../../packages/sandbox-session-client/src/runtime.js";
import { SandboxSessionTransport } from "../../../packages/sandbox-session-client/src/transport.js";

const OPENAI_TARGET_KEY = "openai-default";
const OPENAI_CONNECTION_METHOD_ID = "api-key";
const OPENAI_API_KEY = "sk-system-sandbox-restart";
const SANDBOX_READY_TIMEOUT_MS = 3 * 60_000;
const POLL_INTERVAL_MS = 1_000;
const RUNTIME_READY_POLL_INTERVAL_MS = 100;
const SANDBOX_SESSION_CONNECT_TIMEOUT_MS = 120_000;

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

const StopSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

class RetryableWaitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableWaitError";
  }
}

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

export type CodexSandboxAuthenticatedSession = {
  cookie: string;
  organizationId: string;
  userId: string;
};

export type CodexSandboxRuntimeState = SandboxRuntimeStateSnapshot;

export type CodexSandboxHttpResponse = {
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

export type CodexSandboxRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type CodexSandboxFixture = {
  authSession: (input?: { email?: string }) => Promise<CodexSandboxAuthenticatedSession>;
  request: (path: string, init?: CodexSandboxRequestInit) => Promise<CodexSandboxHttpResponse>;
  dataPlaneApiBaseUrl: string;
  dataPlaneApiHeaders?: Record<string, string>;
  dataPlaneGatewayBaseUrl: string;
  internalAuthServiceToken: string;
  createSessionRuntime?: () => SandboxSessionRuntime;
  readSandboxRuntimeState: (sandboxInstanceId: string) => Promise<CodexSandboxRuntimeState>;
};

const InternalAuthServiceTokenHeader = "x-mistle-service-token";

export async function prepareCodexSandbox(input: {
  fixture: CodexSandboxFixture;
  email?: string;
  authenticatedSession?: CodexSandboxAuthenticatedSession;
}): Promise<{ authenticatedSession: CodexSandboxAuthenticatedSession; sandboxInstanceId: string }> {
  const authenticatedSession =
    input.authenticatedSession ??
    (await input.fixture.authSession({
      ...(input.email === undefined ? {} : { email: input.email }),
    }));
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<ConnectedCodexAgentSession> {
  const connectionUrl = await mintSandboxConnectionUrl(input);
  const transport = new SandboxSessionTransport({
    runtime: createFixtureSessionRuntime(input.fixture),
    connectTimeoutMs: SANDBOX_SESSION_CONNECT_TIMEOUT_MS,
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<void> {
  const connectionUrl = await mintSandboxConnectionUrl(input);
  const result = await runSandboxExecCommand({
    fixture: input.fixture,
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
    fixture: input.fixture,
    connectionUrl,
    command: input.command,
    ...(input.args === undefined ? {} : { args: input.args }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
}

export async function triggerSandboxdEgressProxyKill(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
  fixture: CodexSandboxFixture;
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
  sandboxInstanceId: string;
  expectedStatus: z.infer<typeof SandboxInstanceStatusResponseSchema>["status"];
  timeoutMs?: number;
}): Promise<z.infer<typeof SandboxInstanceStatusResponseSchema>> {
  return waitForCondition({
    description: `sandbox '${input.sandboxInstanceId}' status=${input.expectedStatus}`,
    timeoutMs: input.timeoutMs ?? SANDBOX_READY_TIMEOUT_MS,
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
        throw new RetryableWaitError(
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
        throw new RetryableWaitError(
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
  fixture: CodexSandboxFixture;
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
        ...input.fixture.dataPlaneApiHeaders,
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
        ...input.fixture.dataPlaneApiHeaders,
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
  let lastRetryableError: RetryableWaitError | undefined;

  while (true) {
    try {
      const result = await input.evaluate();
      if (result !== null) {
        return result;
      }
    } catch (error) {
      if (!(error instanceof RetryableWaitError)) {
        throw error;
      }
      lastRetryableError = error;
    }

    const remainingMs = deadlineEpochMs - Date.now();
    if (remainingMs <= 0) {
      const suffix =
        lastRetryableError === undefined
          ? ""
          : ` Last retryable error: ${lastRetryableError.message}`;
      throw new Error(`Timed out waiting for ${input.description}.${suffix}`);
    }

    await systemSleeper.sleep(Math.min(pollIntervalMs, remainingMs));
  }
}

async function createOpenAiConnection(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
  sandboxProfileId: string;
  openAiConnectionId: string;
}): Promise<void> {
  await requestJsonOrThrow({
    request: input.fixture.request,
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
              config: {
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
              },
            },
          ],
        },
      }),
    },
  });
}

async function startSandboxInstance(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
  fixture: CodexSandboxFixture;
  connectionUrl: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}): Promise<SandboxExecResult> {
  const transport = new SandboxSessionTransport({
    runtime: createFixtureSessionRuntime(input.fixture),
    connectTimeoutMs: SANDBOX_SESSION_CONNECT_TIMEOUT_MS,
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

export async function runSandboxPtyCommand(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
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
    runtime: createFixtureSessionRuntime(input.fixture),
    connectTimeoutMs: SANDBOX_SESSION_CONNECT_TIMEOUT_MS,
  });

  await transport.connect({
    connectionUrl,
  });

  try {
    const timeoutMs = input.timeoutMs ?? 30_000;
    const ptyClient = new PtyStreamClient({
      transport,
    });
    let output = "";

    ptyClient.onData((chunk) => {
      output += Buffer.from(chunk).toString("utf8");
    });

    await withOperationTimeout({
      operation: ptyClient.connect(),
      timeoutMs,
      description: "connecting sandbox PTY stream",
    });
    const waitForExit = (): Promise<{ exitCode: number }> =>
      new Promise<{ exitCode: number }>((resolve, reject) => {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
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
          reject(new Error(`Timed out after ${String(timeoutMs)}ms waiting for PTY command exit.`));
        };

        const cleanup = (): void => {
          removeExitListener();
          removeErrorListener();
          removeResetListener();
          timeoutSignal.removeEventListener("abort", onTimeout);
        };

        timeoutSignal.addEventListener("abort", onTimeout, { once: true });
      });
    let exit;

    try {
      await withOperationTimeout({
        operation: ptyClient.open({
          ptySessionId: "terminal",
          cols: 120,
          rows: 40,
          cwd: input.cwd ?? "/root",
          command: input.command,
          ...(input.args === undefined ? {} : { args: input.args }),
        }),
        timeoutMs,
        description: "opening sandbox PTY session",
      });

      exit = await waitForExit();
    } catch (error) {
      throw new Error(
        `Sandbox PTY command failed before exit. Partial output: ${output}. Cause: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      exitCode: exit.exitCode,
      output,
    };
  } finally {
    transport.disconnect(1000, "system test pty cleanup");
  }
}

async function withOperationTimeout<T>(input: {
  operation: Promise<T>;
  timeoutMs: number;
  description: string;
}): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
    const onTimeout = (): void => {
      reject(new Error(`Timed out after ${String(input.timeoutMs)}ms ${input.description}.`));
    };
    const cleanup = (): void => {
      timeoutSignal.removeEventListener("abort", onTimeout);
    };

    timeoutSignal.addEventListener("abort", onTimeout, { once: true });
    input.operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function requestJsonOrThrow<TSchema extends z.ZodType>(input: {
  request: (path: string, init?: CodexSandboxRequestInit) => Promise<CodexSandboxHttpResponse>;
  path: string;
  init: CodexSandboxRequestInit;
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

function createFixtureSessionRuntime(fixture: CodexSandboxFixture): SandboxSessionRuntime {
  return fixture.createSessionRuntime?.() ?? createNodeSandboxSessionRuntime();
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
  for (const [key, value] of gatewayBaseUrl.searchParams.entries()) {
    mintedUrl.searchParams.set(key, value);
  }

  return mintedUrl.toString();
}
