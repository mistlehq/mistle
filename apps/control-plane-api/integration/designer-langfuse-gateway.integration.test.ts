/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  buildCodexThreadStartRequest,
  CodexJsonRpcClient,
  createNodeCodexSessionRuntime,
  parseCodexThreadSessionResponse,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { AgentStreamClient, SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createDockerSandboxNetworkInfra } from "@mistle/test-harness";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { expect } from "vitest";
import { z } from "zod";

import { DashboardControlDynamicToolSpecs } from "../../../apps/dashboard/src/features/session-agents/dashboard-control-actions.js";
import { DesignerSessionSchema } from "../src/designer/index.js";

const OpenAiApiKey = process.env.MISTLE_LANGFUSE_E2E_OPENAI_API_KEY;
const LangfusePublicKey = "pk-lf-integration-designer-gateway";
const LangfuseSecretKey = "sk-lf-integration-designer-gateway";
const RequestTimeoutMs = 5 * 60 * 1000;
const StopHookExportTimeoutMs = 15_000;
const TurnTimeoutMs = 10 * 60 * 1000;
const EndToEndTimeoutMs = 10 * 60 * 1000;

const ConnectionTokenSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api", "data-plane-gateway", "data-plane-worker"],
  __internalInfra: createDockerSandboxNetworkInfra(),
  __serviceOptions: async () => {
    const langfuse = await startSimulatedLangfuseOtlpServer();
    startedLangfuse = langfuse;

    return {
      controlPlaneApi: {
        designerLangfuse: {
          baseUrl: langfuse.baseUrl,
          environment: "development",
          publicKey: LangfusePublicKey,
        },
        platformCredentials: {
          openai: {
            apiKey: requireOpenAiApiKey(),
          },
          langfuse: {
            secretKey: LangfuseSecretKey,
          },
        },
      },
      dataPlaneGateway: {
        platformCredentials: {
          openai: {
            apiKey: requireOpenAiApiKey(),
          },
          langfuse: {
            secretKey: LangfuseSecretKey,
          },
        },
      },
    };
  },
  __afterStart: async () => async () => {
    await startedLangfuse?.close();
    startedLangfuse = undefined;
  },
});

const configuredIt = OpenAiApiKey === undefined ? it.skip : it;

configuredIt(
  "proxies Langfuse Codex OTLP traces through gateway managed egress for a Designer turn",
  async ({ env }) => {
    const langfuse = requireStartedLangfuse();
    const session = await env.auth.createSession({
      email: "integration-new-designer-langfuse-gateway@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        idempotencyKey: "designer-langfuse-gateway-e2e",
        prompt: "Reply with exactly: langfuse gateway ready",
      }),
    });
    expect(createResponse.status).toBe(201);
    const designerSession = DesignerSessionSchema.parse(await createResponse.json());
    const connectionToken = await waitForDesignerConnectionToken({
      cookie: session.cookie,
      fetch: env.controlPlaneApi.http.fetch,
      sessionId: designerSession.id,
    });

    await runOneDesignerTurn({
      connectionUrl: connectionToken.url,
      prompt: "Reply with exactly: langfuse gateway ready",
    });

    const request = await waitForTraceRequestWithin({
      langfuse,
      timeoutMs: StopHookExportTimeoutMs,
    });
    if (request === undefined) {
      throw new Error("Codex Stop hook did not export a Langfuse trace.");
    }
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/public/otel/v1/traces");
    expect(request.authorizationHeaderPresent).toBe(true);
    expect(request.authorizationHeaderUsesBasic).toBe(true);
    expect(request.basicAuthUsername).toBe(LangfusePublicKey);
    expect(request.basicAuthPassword).toBe(LangfuseSecretKey);
    expect(request.publicKeyHeader).toBe(LangfusePublicKey);
    expect(request.bodyBytes).toBeGreaterThan(0);
  },
  EndToEndTimeoutMs,
);

type SimulatedLangfuseRequest = {
  authorizationHeaderPresent: boolean;
  authorizationHeaderUsesBasic: boolean;
  basicAuthPassword: string | undefined;
  basicAuthUsername: string | undefined;
  bodyBytes: number;
  method: string;
  path: string;
  publicKeyHeader: string | undefined;
};

type StartedSimulatedLangfuse = {
  baseUrl: string;
  close: () => Promise<void>;
  waitForTraceRequest: () => Promise<SimulatedLangfuseRequest>;
};

type ControlPlaneFetch = IntegrationTestEnvironment["controlPlaneApi"]["http"]["fetch"];

let startedLangfuse: StartedSimulatedLangfuse | undefined;

function requireOpenAiApiKey(): string {
  if (OpenAiApiKey === undefined || OpenAiApiKey.trim().length === 0) {
    throw new Error("MISTLE_LANGFUSE_E2E_OPENAI_API_KEY is required for this test.");
  }

  return OpenAiApiKey;
}

function requireStartedLangfuse(): StartedSimulatedLangfuse {
  if (startedLangfuse === undefined) {
    throw new Error("Expected simulated Langfuse server to be started.");
  }

  return startedLangfuse;
}

async function startSimulatedLangfuseOtlpServer(): Promise<StartedSimulatedLangfuse> {
  let resolveRequest: (request: SimulatedLangfuseRequest) => void = () => {};
  const requestPromise = new Promise<SimulatedLangfuseRequest>((resolve) => {
    resolveRequest = resolve;
  });
  const server = createServer((request, response) => {
    void handleSimulatedLangfuseRequest({
      request,
      response,
      resolveRequest,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected simulated Langfuse server to listen on a TCP address.");
  }

  return {
    baseUrl: `http://host.docker.internal:${String(address.port)}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    waitForTraceRequest: async () => await requestPromise,
  };
}

async function handleSimulatedLangfuseRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  resolveRequest: (request: SimulatedLangfuseRequest) => void;
}): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of input.request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  const authorization = input.request.headers.authorization;
  const basicAuthCredentials = parseBasicAuthCredentials(authorization);
  const publicKeyHeaderValue = input.request.headers["x-langfuse-public-key"];
  const requestUrl = new URL(input.request.url ?? "/", "http://127.0.0.1");

  // Grounded in Langfuse OTLP ingestion docs and the Codex observability plugin traces exporter:
  // https://langfuse.com/docs/opentelemetry/get-started
  // https://github.com/langfuse/codex-observability-plugin
  if (input.request.method === "POST" && requestUrl.pathname === "/api/public/otel/v1/traces") {
    input.resolveRequest({
      authorizationHeaderPresent: authorization !== undefined,
      authorizationHeaderUsesBasic:
        typeof authorization === "string" && authorization.startsWith("Basic "),
      basicAuthPassword: basicAuthCredentials?.password,
      basicAuthUsername: basicAuthCredentials?.username,
      bodyBytes: body.byteLength,
      method: input.request.method,
      path: requestUrl.pathname,
      publicKeyHeader: typeof publicKeyHeaderValue === "string" ? publicKeyHeaderValue : undefined,
    });
  }

  input.response.writeHead(200, { "content-type": "application/json" });
  input.response.end("{}");
}

function parseBasicAuthCredentials(
  authorization: string | undefined,
): { password: string; username: string } | undefined {
  if (authorization === undefined || !authorization.startsWith("Basic ")) {
    return undefined;
  }

  const encodedCredentials = authorization.slice("Basic ".length);
  const decodedCredentials = Buffer.from(encodedCredentials, "base64").toString("utf8");
  const separatorIndex = decodedCredentials.indexOf(":");
  if (separatorIndex === -1) {
    return undefined;
  }

  return {
    username: decodedCredentials.slice(0, separatorIndex),
    password: decodedCredentials.slice(separatorIndex + 1),
  };
}

async function waitForDesignerConnectionToken(input: {
  cookie: string;
  fetch: ControlPlaneFetch;
  sessionId: string;
}): Promise<z.output<typeof ConnectionTokenSchema>> {
  const deadline = Date.now() + RequestTimeoutMs;
  let lastBody = "";

  while (Date.now() < deadline) {
    const response = await input.fetch(
      `/v1/designer/sessions/${encodeURIComponent(input.sessionId)}/connection-token`,
      {
        method: "POST",
        headers: {
          cookie: input.cookie,
        },
      },
    );
    if (response.status === 201) {
      return ConnectionTokenSchema.parse(await response.json());
    }
    lastBody = await response.text();
    await systemSleeper.sleep(1_000);
  }

  throw new Error(`Timed out waiting for Designer connection token. Last response: ${lastBody}`);
}

async function runOneDesignerTurn(input: { connectionUrl: string; prompt: string }): Promise<void> {
  const runtime = createNodeCodexSessionRuntime();
  const transport = new SandboxSessionTransport({
    runtime,
    connectTimeoutMs: RequestTimeoutMs,
  });
  const agentStreamClient = new AgentStreamClient({ transport });

  await transport.connect({ connectionUrl: input.connectionUrl });
  await agentStreamClient.connect();

  const rpcClient = new CodexJsonRpcClient(agentStreamClient);
  try {
    await rpcClient.initialize();
    const threadResponse = await rpcClient.call(
      "thread/start",
      buildCodexThreadStartRequest({
        dynamicTools: DashboardControlDynamicToolSpecs,
      }),
    );
    const thread = parseCodexThreadSessionResponse({
      method: "thread/start",
      response: threadResponse,
    });
    await expectLangfuseStopHookLoaded({
      rpcClient,
      cwd: "/",
    });
    await waitForTurnCompletion({
      prompt: input.prompt,
      rpcClient,
      threadId: thread.threadId,
    });
  } finally {
    rpcClient.dispose();
    agentStreamClient.disconnect();
    transport.disconnect(1000, "Designer Langfuse gateway test completed.");
  }
}

async function expectLangfuseStopHookLoaded(input: {
  cwd: string;
  rpcClient: CodexJsonRpcClient;
}): Promise<void> {
  const hooksListResponse = await input.rpcClient.call("hooks/list", {
    cwds: [input.cwd],
  });
  const hookEntries = readHooksListEntries(hooksListResponse);
  expect(
    hookEntries.some(
      (entry) =>
        entry.eventName === "stop" &&
        entry.enabled === true &&
        entry.isManaged === true &&
        entry.command ===
          'node "${CODEX_HOME:-$HOME/.codex}/plugins/cache/codex-observability-plugin/tracing/0.1.0/dist/index.mjs"',
    ),
  ).toBe(true);
}

type HookListEntry = {
  command: string | undefined;
  enabled: boolean | undefined;
  eventName: string | undefined;
  isManaged: boolean | undefined;
};

function readHooksListEntries(response: unknown): HookListEntry[] {
  if (!isRecord(response)) {
    throw new Error("Expected hooks/list response to be an object.");
  }
  const data = response["data"];
  if (!Array.isArray(data)) {
    throw new Error("Expected hooks/list response data to be an array.");
  }

  return data.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const hooks = item["hooks"];
    if (!Array.isArray(hooks)) {
      return [];
    }

    return hooks.flatMap((hook): HookListEntry[] => {
      if (!isRecord(hook)) {
        return [];
      }

      return [
        {
          command: typeof hook["command"] === "string" ? hook["command"] : undefined,
          enabled: typeof hook["enabled"] === "boolean" ? hook["enabled"] : undefined,
          eventName: typeof hook["eventName"] === "string" ? hook["eventName"] : undefined,
          isManaged: typeof hook["isManaged"] === "boolean" ? hook["isManaged"] : undefined,
        },
      ];
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitForTurnCompletion(input: {
  prompt: string;
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<void> {
  let unsubscribe = (): void => {};
  const turnCompletion = new Promise<void>((resolve, reject) => {
    unsubscribe = input.rpcClient.onNotification((notification) => {
      if (notification.method !== "turn/completed") {
        return;
      }
      const params = notification.params;
      if (typeof params !== "object" || params === null) {
        return;
      }
      const threadId = Reflect.get(params, "threadId");
      if (threadId !== input.threadId) {
        return;
      }

      resolve();
    });

    void input.rpcClient
      .call("turn/start", {
        threadId: input.threadId,
        input: [
          {
            type: "text",
            text: input.prompt,
          },
        ],
      })
      .catch((error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });

  try {
    await Promise.race([
      turnCompletion,
      systemSleeper.sleep(TurnTimeoutMs).then(() => {
        throw new Error("Timed out waiting for Designer turn completion.");
      }),
    ]);
  } finally {
    unsubscribe();
  }
}

async function waitForTraceRequestWithin(input: {
  langfuse: StartedSimulatedLangfuse;
  timeoutMs: number;
}): Promise<SimulatedLangfuseRequest | undefined> {
  return await Promise.race([
    input.langfuse.waitForTraceRequest(),
    systemSleeper.sleep(input.timeoutMs).then(() => undefined),
  ]);
}
