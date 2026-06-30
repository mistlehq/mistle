import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import {
  buildCodexThreadStartRequest,
  parseCodexThreadReadResponse,
  parseCodexThreadSessionResponse,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import type { JsonRpcId } from "@mistle/sandbox-session-client";
import { systemScheduler } from "@mistle/time";
import { z } from "zod";

import { DashboardControlDynamicToolSpecs } from "../../../../apps/dashboard/src/features/session-agents/dashboard-control-actions.ts";
import { createDesignerEvalArtifacts } from "../artifacts/artifacts.ts";
import { getDesignerEvalCase } from "../cases/registry.ts";
import {
  DefaultDesignerEvalConfigPath,
  loadDesignerEvalConfig,
  type DesignerEvalCodexAuth,
} from "../config/designer-eval-config.ts";
import { createDesignerEvalApiClient } from "../control-plane/api-client.ts";
import { createDesignerEvalDashboardControlAdapter } from "../control-plane/dashboard-control-adapter.ts";
import { startDesignerEvalControlPlane } from "../control-plane/eval-control-plane.ts";
import {
  createDesignerEvalSessionState,
  readDesignerEvalProductState,
} from "../control-plane/in-memory-state.ts";
import {
  startDesignerEvalContainer,
  type StartedDesignerEvalContainer,
} from "../docker/designer-eval-container.ts";
import { evaluateDesignerEvalRun } from "../evaluator/evaluator.ts";
import { compileEvalDesignerRuntime } from "../runtime/compile-eval-designer-runtime.ts";
import {
  connectDirectCodexJsonRpcClient,
  type DirectCodexJsonRpcClient,
} from "../runtime/direct-codex-json-rpc-client.ts";
import { materializeDesignerRuntimeFiles } from "../runtime/materialize-runtime-files.ts";
import { resolveDesignerEvalCodexRuntime } from "../runtime/resolve-codex-runtime-client.ts";
import { renderTranscriptMarkdown } from "../transcript/transcript.ts";
import type {
  DesignerEvalAnswer,
  DesignerEvalDashboardControlAction,
  DesignerEvalInputResponse,
} from "../types.ts";
import { RepositoryRootPath, resolveRepositoryPath } from "./paths.ts";

const DesignerEvalStartParamsSchema = z
  .object({
    artifactRoot: z.string().trim().min(1).optional(),
    caseId: z.string().trim().min(1).default("github-pr-review-basic"),
    codexAuth: z.enum(["local", "none"]).optional(),
    codexAuthPath: z.string().trim().min(1).optional(),
    configPath: z.string().trim().min(1).optional(),
    connectTimeoutMs: z.number().int().positive().optional(),
    message: z.string().min(1).optional(),
    streamRuntimeEvents: z.boolean().optional(),
    startupTimeoutMs: z.number().int().positive().optional(),
    strategy: z.string().min(1).optional(),
  })
  .strict();

const DesignerEvalAnswerSchema: z.ZodType<DesignerEvalAnswer> = z.object({
  id: z.string().trim().min(1),
  value: z.union([z.string(), z.array(z.string())]),
});

const DesignerEvalInputResponseSchema: z.ZodType<DesignerEvalInputResponse> = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("answers"),
      answers: z.array(DesignerEvalAnswerSchema),
    }),
    z.object({
      kind: z.literal("customResponse"),
      text: z.string(),
    }),
    z.object({
      kind: z.literal("cancel"),
    }),
  ],
);

const DesignerEvalAgentInputResponseSchema = z.union([
  DesignerEvalInputResponseSchema,
  z
    .object({
      response: DesignerEvalInputResponseSchema,
      rationale: z.string().min(1).optional(),
    })
    .strict(),
]);

async function main(): Promise<void> {
  const peer = createStdioJsonRpcPeer();
  const startRequest = await peer.readNextRequest();
  if (startRequest.method !== "designerEval/start") {
    peer.respondError(startRequest.id, -32601, "Expected designerEval/start as the first request.");
    return;
  }

  try {
    const result = await runAgentAssistedEval({
      params: DesignerEvalStartParamsSchema.parse(startRequest.params ?? {}),
      peer,
    });
    peer.respond(startRequest.id, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    peer.respondError(startRequest.id, -32000, message);
  } finally {
    peer.close();
  }
}

async function runAgentAssistedEval(input: {
  params: z.infer<typeof DesignerEvalStartParamsSchema>;
  peer: StdioJsonRpcPeer;
}): Promise<{
  artifactDir: string;
  caseId: string;
  designerSessionId: string;
  passed: boolean;
}> {
  const evalConfig = loadDesignerEvalConfig({
    configPath:
      input.params.configPath === undefined
        ? DefaultDesignerEvalConfigPath
        : resolveRepositoryPath(input.params.configPath),
  });
  const baseEvalCase = getDesignerEvalCase(input.params.caseId);
  const prompt = input.params.message ?? baseEvalCase.prompt;
  const evalCase = {
    ...baseEvalCase,
    prompt,
  };
  const artifactRoot =
    input.params.artifactRoot === undefined
      ? resolve(RepositoryRootPath, ".local/designer-evals/runs")
      : resolveRepositoryPath(input.params.artifactRoot);

  await mkdir(artifactRoot, { recursive: true });
  const runStartedAt = new Date().toISOString();
  const runDate = runStartedAt.slice(0, 10);
  const runId = runStartedAt.replaceAll(/[:.]/gu, "-");
  const runKey = `${runId}-${evalCase.id}`.replaceAll(/[^a-zA-Z0-9_-]/gu, "_").toLowerCase();
  const state = createDesignerEvalSessionState({
    evalCase,
    runKey,
  });
  const controlPlane = await startDesignerEvalControlPlane({ state });
  let startedContainer: StartedDesignerEvalContainer | undefined;

  try {
    const artifacts = await createDesignerEvalArtifacts({
      artifactRoot,
      caseId: evalCase.id,
      runDate,
      runKey,
    });
    input.peer.notify("designerEval/started", {
      artifactDir: artifacts.artifactDir,
      caseId: evalCase.id,
      prompt,
      runKey,
      seededState: state.seededState,
      ...(input.params.strategy === undefined ? {} : { strategy: input.params.strategy }),
    });

    const productStateBefore = readDesignerEvalProductState({ state });
    await artifacts.writeProductStateBefore(productStateBefore);

    const apiClient = createDesignerEvalApiClient({
      baseUrl: controlPlane.baseUrl,
    });
    const designerSessionId = state.designerSession.id;
    const runtimePlan = compileEvalDesignerRuntime({
      availableProviderResources: state.availableProviderResources,
      config: evalConfig,
      designerSessionId,
      initialPrompt: prompt,
      openAiProviderMode: "local_subscription",
      seededState: state.seededState,
    });
    const resolvedRuntime = resolveDesignerEvalCodexRuntime(runtimePlan);
    const materializedFiles = await materializeDesignerRuntimeFiles({
      files: resolvedRuntime.setupFiles,
      outputDir: join(artifacts.artifactDir, "runtime-files"),
    });
    startedContainer = await startDesignerEvalContainer({
      runtimeClient: resolvedRuntime.containerRuntimeClient,
      materializedFiles,
      bindMounts: await resolveCodexAuthBindMounts({
        codexAuth: input.params.codexAuth ?? evalConfig.codex.auth,
        codexAuthPath:
          input.params.codexAuthPath === undefined
            ? (evalConfig.codex.authPath ?? resolve(homedir(), ".codex/auth.json"))
            : resolveRepositoryPath(input.params.codexAuthPath),
      }),
      ...(input.params.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: input.params.startupTimeoutMs }),
    });

    const rpcClient = await connectDirectCodexJsonRpcClient({
      authorizationBearerToken: startedContainer.websocketAuthToken,
      websocketUrl: startedContainer.websocketUrl,
      ...(input.params.connectTimeoutMs === undefined
        ? {}
        : { connectTimeoutMs: input.params.connectTimeoutMs }),
    });
    const dashboardActions: DesignerEvalDashboardControlAction[] = [];
    let transcriptMarkdown = "";
    let rejectServerRequestFailure: (error: Error) => void = () => {};
    const serverRequestFailure = new Promise<never>((_resolve, reject) => {
      rejectServerRequestFailure = reject;
    });

    const adapter = createDesignerEvalDashboardControlAdapter({
      apiClient,
      designerSessionId,
      resolveUserInput: async (request) => {
        const inputId = readDesignerUserInputId(request);
        const responseResult = await input.peer.call("designerEval/inputRequested", {
          artifactDir: artifacts.artifactDir,
          caseId: evalCase.id,
          inputId,
          productState: readDesignerEvalProductState({ state }),
          prompt,
          request,
          seededState: state.seededState,
          ...(input.params.strategy === undefined ? {} : { strategy: input.params.strategy }),
        });
        const parsedResponse = parseAgentInputResponse(responseResult);
        await artifacts.writeInputResponse({
          inputId,
          request,
          response: parsedResponse.response,
          ...(parsedResponse.rationale === undefined
            ? {}
            : { rationale: parsedResponse.rationale }),
        });
        return parsedResponse.response;
      },
      writeCanvasTabs: async (tabs) => {
        await apiClient.putJson(
          `/v1/designer/sessions/${encodeURIComponent(designerSessionId)}/canvas-tabs`,
          { tabs },
        );
      },
    });

    const unsubscribeNotifications = rpcClient.onNotification((notification) => {
      void artifacts.writeRawEvent({
        kind: "notification",
        notification,
      });
      if (input.params.streamRuntimeEvents === true) {
        input.peer.notify("designerEval/runtimeNotification", notification);
      }
    });
    const unsubscribeServerRequests = rpcClient.onServerRequest((request) => {
      void (async (): Promise<void> => {
        try {
          await artifacts.writeRawEvent({
            kind: "server_request",
            request,
          });
          const handled = await adapter.handleServerRequest(request);
          dashboardActions.push(handled.action);
          await artifacts.writeDashboardAction(handled.action);
          await rpcClient.respond(request.id, handled.response);
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          const failureResponse = createDashboardControlFailureResponse(failure.message);
          await artifacts.writeRawEvent({
            kind: "server_request_error",
            request,
            message: failure.message,
          });
          await rpcClient.respond(request.id, failureResponse).catch(() => {});
          rejectServerRequestFailure(failure);
        }
      })();
    });

    try {
      await rpcClient.initialize();
      const thread = await startDesignerEvalCodexThread({
        rpcClient,
        dynamicTools: DashboardControlDynamicToolSpecs,
      });
      const completedTurn = await Promise.race([
        waitForDesignerTurnCompletion({
          rpcClient,
          threadId: thread.threadId,
          prompt,
        }),
        serverRequestFailure,
      ]);
      const threadRead = await readDesignerEvalCodexThread({
        rpcClient,
        threadId: completedTurn.threadId,
      });
      transcriptMarkdown = renderTranscriptMarkdown({
        caseId: evalCase.id,
        threadId: threadRead.threadId,
        turns: threadRead.turns,
      });
      await artifacts.writeTranscript({
        markdown: transcriptMarkdown,
        rawThread: threadRead.response,
      });
    } finally {
      unsubscribeServerRequests();
      unsubscribeNotifications();
      rpcClient.dispose();
    }

    const productStateAfter = readDesignerEvalProductState({ state });
    await artifacts.writeProductStateAfter(productStateAfter);

    const result = evaluateDesignerEvalRun({
      caseId: evalCase.id,
      assertions: evalCase.assertions,
      dashboardControlActions: dashboardActions,
      productStateAfter,
      transcriptMarkdown,
    });
    await artifacts.writeEvaluation(result);
    input.peer.notify("designerEval/completed", {
      artifactDir: artifacts.artifactDir,
      caseId: evalCase.id,
      designerSessionId,
      passed: result.passed,
    });

    return {
      artifactDir: artifacts.artifactDir,
      caseId: evalCase.id,
      designerSessionId,
      passed: result.passed,
    };
  } finally {
    if (startedContainer !== undefined) {
      await startedContainer.stop();
    }
    await controlPlane.close();
  }
}

function parseAgentInputResponse(input: unknown): {
  response: DesignerEvalInputResponse;
  rationale?: string;
} {
  const parsed = DesignerEvalAgentInputResponseSchema.parse(input);
  if ("response" in parsed) {
    return {
      response: parsed.response,
      ...(parsed.rationale === undefined ? {} : { rationale: parsed.rationale }),
    };
  }

  return {
    response: parsed,
  };
}

function readDesignerUserInputId(request: unknown): string {
  if (typeof request !== "object" || request === null) {
    throw new Error("Designer user input request must be an object.");
  }
  const inputId = Reflect.get(request, "id");
  if (typeof inputId !== "string" || inputId.length === 0) {
    throw new Error("Designer user input request requires a non-empty id.");
  }
  return inputId;
}

function createDashboardControlFailureResponse(message: string): {
  success: false;
  contentItems: readonly [{ type: "inputText"; text: string }];
} {
  return {
    success: false,
    contentItems: [
      {
        type: "inputText",
        text: message,
      },
    ],
  };
}

async function resolveCodexAuthBindMounts(input: {
  codexAuth: DesignerEvalCodexAuth;
  codexAuthPath: string;
}): Promise<readonly [{ source: string; target: string; mode: "ro" }] | readonly []> {
  if (input.codexAuth === "none") {
    return [];
  }

  await access(input.codexAuthPath);
  return [
    {
      source: input.codexAuthPath,
      target: "/root/.codex/auth.json",
      mode: "ro",
    },
  ];
}

async function startDesignerEvalCodexThread(input: {
  rpcClient: DirectCodexJsonRpcClient;
  dynamicTools: typeof DashboardControlDynamicToolSpecs;
}): Promise<{ threadId: string; cwd: string; response: unknown }> {
  const response = await input.rpcClient.call(
    "thread/start",
    buildCodexThreadStartRequest({
      dynamicTools: input.dynamicTools,
    }),
  );
  const parsed = parseCodexThreadSessionResponse({
    method: "thread/start",
    response,
  });

  return {
    threadId: parsed.threadId,
    cwd: parsed.cwd,
    response,
  };
}

async function readDesignerEvalCodexThread(input: {
  rpcClient: DirectCodexJsonRpcClient;
  threadId: string;
}): Promise<{
  threadId: string;
  name: string | null;
  preview: string | null;
  turns: readonly { id: string; status: string | null; items: readonly unknown[] }[];
  response: unknown;
}> {
  const response = await input.rpcClient.call("thread/read", {
    threadId: input.threadId,
    includeTurns: true,
  });

  return parseCodexThreadReadResponse(response);
}

async function waitForDesignerTurnCompletion(input: {
  rpcClient: DirectCodexJsonRpcClient;
  threadId: string;
  prompt: string;
}): Promise<{ threadId: string; turnId: string }> {
  return await new Promise((resolve, reject) => {
    const timeout = systemScheduler.schedule(
      () => {
        unsubscribe();
        reject(new Error("Timed out waiting for Designer turn completion."));
      },
      10 * 60 * 1000,
    );

    const unsubscribe = input.rpcClient.onNotification((notification) => {
      if (notification.method !== "turn/completed") {
        return;
      }
      const params = notification.params;
      if (typeof params !== "object" || params === null) {
        return;
      }
      const threadId = Reflect.get(params, "threadId");
      const turnId = readCompletedTurnId(params);
      if (threadId !== input.threadId || typeof turnId !== "string") {
        return;
      }
      systemScheduler.cancel(timeout);
      unsubscribe();
      resolve({ threadId, turnId });
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
        systemScheduler.cancel(timeout);
        unsubscribe();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function readCompletedTurnId(params: object): string | undefined {
  const topLevelTurnId = Reflect.get(params, "turnId");
  if (typeof topLevelTurnId === "string") {
    return topLevelTurnId;
  }

  const turn = Reflect.get(params, "turn");
  if (typeof turn !== "object" || turn === null) {
    return undefined;
  }

  const nestedTurnId = Reflect.get(turn, "id");
  return typeof nestedTurnId === "string" ? nestedTurnId : undefined;
}

type JsonRpcRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type StdioJsonRpcPeer = {
  call: (method: string, params?: unknown) => Promise<unknown>;
  close: () => void;
  notify: (method: string, params?: unknown) => void;
  readNextRequest: () => Promise<JsonRpcRequest>;
  respond: (id: JsonRpcId, result: unknown) => void;
  respondError: (id: JsonRpcId, code: number, message: string) => void;
};

function createStdioJsonRpcPeer(): StdioJsonRpcPeer {
  let nextId = 0;
  let closed = false;
  const pendingRequests = new Map<JsonRpcId, PendingRequest>();
  const inboundRequests: JsonRpcRequest[] = [];
  const waitingInboundRequests: ((request: JsonRpcRequest) => void)[] = [];
  const readline = createInterface({
    input: process.stdin,
    terminal: false,
  });

  readline.on("line", (line) => {
    const payload = parseJsonObject(line);
    if (isJsonRpcResponse(payload)) {
      const pendingRequest = pendingRequests.get(payload.id);
      if (pendingRequest === undefined) {
        return;
      }
      pendingRequests.delete(payload.id);
      if ("error" in payload) {
        pendingRequest.reject(
          new Error(
            `JSON-RPC request ${String(payload.id)} '${pendingRequest.method}' failed: ${payload.error.message}`,
          ),
        );
        return;
      }
      pendingRequest.resolve(payload.result);
      return;
    }

    if (!isJsonRpcRequest(payload)) {
      writeJson({
        id: null,
        error: {
          code: -32600,
          message: "Invalid JSON-RPC request.",
        },
      });
      return;
    }

    const waitingRequest = waitingInboundRequests.shift();
    if (waitingRequest === undefined) {
      inboundRequests.push(payload);
      return;
    }
    waitingRequest(payload);
  });

  return {
    call: async (method, params) => {
      const id = nextId;
      nextId += 1;
      const promise = new Promise<unknown>((resolvePending, rejectPending) => {
        pendingRequests.set(id, {
          method,
          resolve: resolvePending,
          reject: rejectPending,
        });
      });
      writeJson({
        id,
        method,
        ...(params === undefined ? {} : { params }),
      });
      return await promise;
    },
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      readline.close();
      for (const pendingRequest of pendingRequests.values()) {
        pendingRequest.reject(new Error("Stdio JSON-RPC peer closed."));
      }
      pendingRequests.clear();
    },
    notify: (method, params) => {
      writeJson({
        method,
        ...(params === undefined ? {} : { params }),
      });
    },
    readNextRequest: async () => {
      const request = inboundRequests.shift();
      if (request !== undefined) {
        return request;
      }
      return await new Promise<JsonRpcRequest>((resolveRequest) => {
        waitingInboundRequests.push(resolveRequest);
      });
    },
    respond: (id, result) => {
      writeJson({ id, result });
    },
    respondError: (id, code, message) => {
      writeJson({
        id,
        error: {
          code,
          message,
        },
      });
    },
  };
}

type JsonRpcObject = Record<string, unknown>;

type JsonRpcResponse =
  | {
      id: JsonRpcId;
      result: unknown;
    }
  | {
      id: JsonRpcId;
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
    };

function parseJsonObject(line: string): JsonRpcObject {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON-RPC object.");
  }

  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, value]));
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

function isJsonRpcRequest(value: JsonRpcObject): value is JsonRpcRequest {
  return isJsonRpcId(Reflect.get(value, "id")) && typeof Reflect.get(value, "method") === "string";
}

function isJsonRpcResponse(value: JsonRpcObject): value is JsonRpcResponse {
  const id = Reflect.get(value, "id");
  if (!isJsonRpcId(id)) {
    return false;
  }
  if ("result" in value) {
    return true;
  }

  const error = Reflect.get(value, "error");
  return (
    typeof error === "object" &&
    error !== null &&
    typeof Reflect.get(error, "code") === "number" &&
    typeof Reflect.get(error, "message") === "string"
  );
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
