import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildCodexThreadStartRequest,
  parseCodexThreadReadResponse,
  parseCodexThreadSessionResponse,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { systemScheduler } from "@mistle/time";

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
import { startDesignerEvalContainer } from "../docker/designer-eval-container.ts";
import type { StartedDesignerEvalContainer } from "../docker/designer-eval-container.ts";
import { evaluateDesignerEvalRun } from "../evaluator/evaluator.ts";
import { compileEvalDesignerRuntime } from "../runtime/compile-eval-designer-runtime.ts";
import {
  connectDirectCodexJsonRpcClient,
  type DirectCodexJsonRpcClient,
} from "../runtime/direct-codex-json-rpc-client.ts";
import { materializeDesignerRuntimeFiles } from "../runtime/materialize-runtime-files.ts";
import { resolveDesignerEvalCodexRuntimeClient } from "../runtime/resolve-codex-runtime-client.ts";
import { renderTranscriptMarkdown } from "../transcript/transcript.ts";
import type {
  DesignerEvalAssertion,
  DesignerEvalDashboardControlAction,
  DesignerEvalSeededState,
} from "../types.ts";
import { RepositoryRootPath, resolveRepositoryPath } from "./paths.ts";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const evalConfig = loadDesignerEvalConfig({
    configPath: options.configPath,
  });
  const evalCase = getDesignerEvalCase(options.caseId);
  const artifactRoot =
    options.artifactRoot ?? resolve(RepositoryRootPath, ".local/designer-evals/runs");

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
    const productStateBefore = readDesignerEvalProductState({
      state,
    });
    await artifacts.writeProductStateBefore(productStateBefore);

    const apiClient = createDesignerEvalApiClient({
      baseUrl: controlPlane.baseUrl,
    });
    const designerSessionId = state.designerSession.id;
    const runtimePlan = compileEvalDesignerRuntime({
      availableRepositoryHandles: evalCase.seed.githubRepositoryHandles,
      config: evalConfig,
      designerSessionId,
      evalControlPlaneBaseUrl: controlPlane.baseUrl,
      initialPrompt: evalCase.prompt,
      openAiProviderMode: "local_subscription",
      organizationId: state.designerSession.organizationId,
      seededState: state.seededState,
    });
    const codexClient = runtimePlan.runtimeClients.find(
      (runtimeClient) => runtimeClient.clientId === "codex-cli",
    );
    if (codexClient === undefined) {
      throw new Error("Designer runtime plan did not include the codex-cli runtime client.");
    }
    const materializedFiles = await materializeDesignerRuntimeFiles({
      files: codexClient.setup.files,
      outputDir: join(artifacts.artifactDir, "runtime-files"),
    });
    startedContainer = await startDesignerEvalContainer({
      runtimeClient: resolveDesignerEvalCodexRuntimeClient(runtimePlan),
      materializedFiles,
      bindMounts: await resolveCodexAuthBindMounts({
        codexAuth: options.codexAuth ?? evalConfig.codex.auth,
        codexAuthPath:
          options.codexAuthPath ??
          evalConfig.codex.authPath ??
          resolve(homedir(), ".codex/auth.json"),
      }),
      startupTimeoutMs: options.startupTimeoutMs,
    });

    const rpcClient = await connectDirectCodexJsonRpcClient({
      authorizationBearerToken: startedContainer.websocketAuthToken,
      websocketUrl: startedContainer.websocketUrl,
      connectTimeoutMs: options.connectTimeoutMs,
    });
    const dashboardActions: DesignerEvalDashboardControlAction[] = [];
    let rejectServerRequestFailure: (error: Error) => void = () => {};
    const serverRequestFailure = new Promise<never>((_resolve, reject) => {
      rejectServerRequestFailure = reject;
    });

    const adapter = createDesignerEvalDashboardControlAdapter({
      apiClient,
      designerSessionId,
      resolveUserInput: async (request) => {
        const inputId = readDesignerUserInputId(request);
        const scriptedInput = evalCase.scriptedInputs[inputId];
        if (scriptedInput === undefined) {
          throw new Error(
            `Designer requested user input '${inputId}', but the eval case has no scripted response for that id.`,
          );
        }
        return scriptedInput;
      },
      writeCanvasTabs: async (tabs) => {
        await apiClient.putJson(
          `/v1/designer/sessions/${encodeURIComponent(designerSessionId)}/canvas-tabs`,
          {
            tabs,
          },
        );
      },
    });

    const unsubscribeNotifications = rpcClient.onNotification((notification) => {
      void artifacts.writeRawEvent({
        kind: "notification",
        notification,
      });
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
          prompt: evalCase.prompt,
        }),
        serverRequestFailure,
      ]);
      const threadRead = await readDesignerEvalCodexThread({
        rpcClient,
        threadId: completedTurn.threadId,
      });
      await artifacts.writeTranscript({
        markdown: renderTranscriptMarkdown({
          caseId: evalCase.id,
          threadId: threadRead.threadId,
          turns: threadRead.turns,
        }),
        rawThread: threadRead.response,
      });
    } finally {
      unsubscribeServerRequests();
      unsubscribeNotifications();
      rpcClient.dispose();
    }

    const productStateAfter = readDesignerEvalProductState({
      state,
    });
    await artifacts.writeProductStateAfter(productStateAfter);

    const result = evaluateDesignerEvalRun({
      caseId: evalCase.id,
      assertions: resolveSeededAssertions({
        assertions: evalCase.assertions,
        seededState: state.seededState,
      }),
      dashboardControlActions: dashboardActions,
      productStateAfter,
    });
    await artifacts.writeEvaluation(result);

    console.log(`Designer eval ${result.passed ? "passed" : "failed"}: ${evalCase.id}`);
    console.log(`Artifacts: ${artifacts.artifactDir}`);
    if (!result.passed) {
      process.exitCode = 1;
    }
    console.log(`Designer session: ${designerSessionId}`);
  } finally {
    if (startedContainer !== undefined) {
      await startedContainer.stop();
    }
    await controlPlane.close();
  }
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

function resolveSeededAssertions(input: {
  assertions: readonly DesignerEvalAssertion[];
  seededState: DesignerEvalSeededState;
}): readonly DesignerEvalAssertion[] {
  return input.assertions.map((assertion) => {
    if (assertion.kind !== "saved-selected-provider-resources") {
      return assertion;
    }

    return {
      ...assertion,
      profileId: input.seededState.targetDraft.profileId,
      version: input.seededState.targetDraft.version,
      connectionId: input.seededState.githubConnectionId,
    };
  });
}

function parseArgs(args: readonly string[]): {
  artifactRoot?: string;
  caseId: string;
  codexAuth?: DesignerEvalCodexAuth;
  codexAuthPath?: string;
  configPath: string;
  connectTimeoutMs: number;
  startupTimeoutMs: number;
} {
  let artifactRoot: string | undefined;
  let caseId = "github-pr-review-basic";
  let codexAuth: DesignerEvalCodexAuth | undefined;
  let codexAuthPath: string | undefined;
  let configPath = DefaultDesignerEvalConfigPath;
  let connectTimeoutMs = 30_000;
  let startupTimeoutMs = 60_000;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--case" && next !== undefined) {
      caseId = next;
      index += 1;
      continue;
    }
    if (arg === "--codex-auth" && next !== undefined) {
      codexAuth = parseCodexAuth(next);
      index += 1;
      continue;
    }
    if (arg === "--codex-auth-path" && next !== undefined) {
      codexAuthPath = resolveRepositoryPath(next);
      index += 1;
      continue;
    }
    if (arg === "--config" && next !== undefined) {
      configPath = resolveRepositoryPath(next);
      index += 1;
      continue;
    }
    if (arg === "--connect-timeout-ms" && next !== undefined) {
      connectTimeoutMs = parsePositiveInteger(next, "--connect-timeout-ms");
      index += 1;
      continue;
    }
    if (arg === "--startup-timeout-ms" && next !== undefined) {
      startupTimeoutMs = parsePositiveInteger(next, "--startup-timeout-ms");
      index += 1;
      continue;
    }
    if (arg === "--artifact-root" && next !== undefined) {
      artifactRoot = resolveRepositoryPath(next);
      index += 1;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown or incomplete argument '${arg ?? ""}'.`);
  }

  return {
    ...(artifactRoot === undefined ? {} : { artifactRoot }),
    caseId,
    ...(codexAuth === undefined ? {} : { codexAuth }),
    ...(codexAuthPath === undefined ? {} : { codexAuthPath }),
    configPath,
    connectTimeoutMs,
    startupTimeoutMs,
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

function parseCodexAuth(value: string): DesignerEvalCodexAuth {
  if (value === "local" || value === "none") {
    return value;
  }

  throw new Error("--codex-auth must be 'local' or 'none'.");
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
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
      resolve({
        threadId,
        turnId,
      });
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

function printHelp(): void {
  console.log(`Usage: pnpm designer:eval --case github-pr-review-basic

Options:
  --case <id>                 Eval case id. Defaults to github-pr-review-basic.
  --config <path>             Designer eval config path. Defaults to ${DefaultDesignerEvalConfigPath}.
  --artifact-root <dir>       Artifact root. Defaults to .local/designer-evals/runs.
  --codex-auth local|none     Override eval config Codex auth mode.
  --codex-auth-path <path>    Local Codex auth file. Defaults to config auth_path or ~/.codex/auth.json.
  --connect-timeout-ms <ms>   Raw app-server websocket timeout. Defaults to 30000.
  --startup-timeout-ms <ms>   Docker container startup timeout. Defaults to 60000.
`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
