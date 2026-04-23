import { randomUUID } from "node:crypto";

import { AutomationRunStatuses } from "@mistle/db/control-plane";
import {
  AgentStreamClient,
  CodexJsonRpcClient,
  readCodexThread,
  resumeCodexThread,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { systemSleeper } from "@mistle/time";
import { z } from "zod";

import { createNodeSandboxSessionRuntime } from "../../../packages/sandbox-session-client/src/node.js";
import { SandboxSessionTransport } from "../../../packages/sandbox-session-client/src/transport.js";
import type { AuthenticatedSession, SystemTestFixture } from "../system-test-context.js";
import {
  readGitHubAppWebhookConfig,
  resolveGitHubAppInstallationId,
  updateGitHubAppWebhookConfig,
} from "./github-app-installation.js";

export const OpenAiTargetKey = "openai-default";
export const GitHubTargetKey = "github-cloud";
export const OpenAiConnectionMethodId = "api-key";
export const GitHubConnectionMethodId = "github-app-installation";
export const TestTimeoutMs = 10 * 60_000;
export const TunnelStartupTimeoutMs = 60_000;
export const PollIntervalMs = 2_000;
export const SandboxReadyTimeoutMs = 3 * 60_000;
export const WebhookDeliveryTimeoutMs = 3 * 60_000;
export const AutomationRunTimeoutMs = 3 * 60_000;
export const ResourceSyncTimeoutMs = 2 * 60_000;
export const ThreadReadTimeoutMs = 90_000;
export const AgentReplyTimeoutMs = 3 * 60_000;
export const GitHubIssueCommentConsistencyTimeoutMs = 30_000;

const RequiredEnvNames = [
  "MISTLE_TEST_OPENAI_API_KEY",
  "MISTLE_TEST_GITHUB_TOKEN",
  "MISTLE_TEST_GITHUB_TEST_REPOSITORY",
  "MISTLE_TEST_GITHUB_APP_ID",
  "MISTLE_TEST_GITHUB_APP_SLUG",
  "MISTLE_TEST_GITHUB_APP_CLIENT_ID",
  "MISTLE_TEST_GITHUB_APP_CLIENT_SECRET",
  "MISTLE_TEST_GITHUB_APP_PRIVATE_KEY_PEM",
  "MISTLE_TEST_GITHUB_WEBHOOK_SECRET",
  "CLOUDFLARE_TUNNEL_ID",
  "CLOUDFLARE_TUNNEL_CREDENTIALS_JSON",
  "CONTROL_PLANE_API_TUNNEL_HOSTNAME",
] as const;

const IntegrationConnectionResponseSchema = z.looseObject({
  id: z.string().min(1),
});

const IntegrationWebhookSourceResponseSchema = z.looseObject({
  id: z.string().min(1),
  targetKey: z.string().min(1),
  integrationConnectionId: z.string().min(1),
  endpointKey: z.string().min(1),
  callbackUrl: z.string().min(1).optional(),
});

const SandboxProfileResponseSchema = z.looseObject({
  id: z.string().min(1),
});

const WebhookAutomationResponseSchema = z.looseObject({
  id: z.string().min(1),
});

const StartRedirectConnectionResponseSchema = z
  .object({
    authorizationUrl: z.url(),
  })
  .strict();

const RefreshIntegrationConnectionResourcesResponseSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.literal("repository"),
    syncState: z.enum(["syncing", "ready", "error"]),
  })
  .strict();

const SandboxInstanceStatusResponseSchema = z.looseObject({
  id: z.string().min(1),
  status: z.enum(["pending", "starting", "running", "stopped", "failed"]),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  runtimePlan: z.unknown().nullable().optional(),
  automationConversation: z.unknown().nullable().optional(),
});

const SandboxInstanceConnectionTokenResponseSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

const GitHubIssueResponseSchema = z.looseObject({
  number: z.number().int().positive(),
});

const GitHubIssueCommentResponseSchema = z.looseObject({
  id: z.number().int().positive(),
  body: z.string().min(1),
});

const GitHubIssueCommentListResponseSchema = z.array(GitHubIssueCommentResponseSchema);

type GitHubIssueComment = z.infer<typeof GitHubIssueCommentResponseSchema>;
type CodexThreadReadResult = Awaited<ReturnType<typeof readCodexThread>>;
type GitHubWebhookSource = z.infer<typeof IntegrationWebhookSourceResponseSchema>;
type CodexNotification = Parameters<CodexJsonRpcClient["onNotification"]>[0] extends (
  notification: infer T,
) => void
  ? T
  : never;
type ObservedCodexCommandExecution = {
  command: string;
  aggregatedOutput: string | null;
  exitCode: number | null;
  status: string | null;
};
type ObservedCodexTurnCompletion = {
  turnId: string;
  status: string;
  errorMessage: string | null;
};

export type GitHubRepository = {
  owner: string;
  repo: string;
};

export type GitHubWebhookAutomationConversation = {
  automationRunId: string;
  conversationId: string;
  automationInstructionsSnapshot: string | null;
  issueNumber: number;
  payloadMarker: string;
  expectedInputSubstring: string;
  providerConversationId: string;
  sandboxInstanceId: string;
  repository: GitHubRepository;
  githubToken: string;
  rpcClient: CodexJsonRpcClient;
  initialThreadRead: CodexThreadReadResult;
  buildExpectedSessionLinkUrl: () => string;
  reconnectRpcClient: () => Promise<CodexJsonRpcClient>;
  cleanup: () => Promise<void>;
};

export type GitHubWebhookAutomationFollowUp = {
  automationRunId: string;
  conversationId: string;
  commentBody: string;
  expectedInputSubstring: string;
  providerConversationId: string;
  sandboxInstanceId: string;
};

export function hasRequiredGitHubWebhookAutomationEnv(): boolean {
  return RequiredEnvNames.every((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.length > 0;
  });
}

export function requireGitHubWebhookAutomationEnv(name: (typeof RequiredEnvNames)[number]): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function parseGitHubRepository(input: string): GitHubRepository {
  const [owner, repo, ...rest] = input.split("/");
  if (
    owner === undefined ||
    owner.length === 0 ||
    repo === undefined ||
    repo.length === 0 ||
    rest.length > 0
  ) {
    throw new Error(
      `MISTLE_TEST_GITHUB_TEST_REPOSITORY must be 'owner/repo'. Received '${input}'.`,
    );
  }

  return {
    owner,
    repo,
  };
}

export function resolveControlPlaneApiLocalPort(controlPlaneApiBaseUrl: string): number {
  const baseUrl = new URL(controlPlaneApiBaseUrl);
  const parsedPort = Number.parseInt(baseUrl.port, 10);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error("Control plane API base URL must include a positive numeric port.");
  }

  return parsedPort;
}

function createGitHubAppInstallationCompletePath(input: { query: Record<string, string> }): string {
  const searchParams = new URLSearchParams(input.query);
  return `/p/integration/callbacks/github-app-installation?${searchParams.toString()}`;
}

function buildGitHubWebhookCallbackUrl(input: {
  publicHostname: string;
  targetKey: string;
  endpointKey: string;
}): string {
  const url = new URL(`https://${input.publicHostname}`);
  url.pathname = `/p/integration/webhooks/${encodeURIComponent(input.targetKey)}/${encodeURIComponent(input.endpointKey)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildSandboxSessionLinkUrl(input: {
  publicHostname: string;
  sandboxInstanceId: string;
}): string {
  const url = new URL(`https://${input.publicHostname}`);
  url.pathname = `/p/sessions/${encodeURIComponent(input.sandboxInstanceId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
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

async function githubRequestJson<TSchema extends z.ZodType>(input: {
  method: string;
  path: string;
  token: string;
  body?: unknown;
  description: string;
  schema: TSchema;
}): Promise<z.infer<TSchema>> {
  const response = await fetch(`https://api.github.com${input.path}`, {
    method: input.method,
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });

  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(
      `${input.description} failed with status ${String(response.status)}. Response body: ${bodyText}`,
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

function isGitHubIssueCommentNodeConsistencyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("GitHub issue comment creation") &&
    error.message.includes("Could not resolve to a node with the global id")
  );
}

async function createGitHubIssueCommentWithConsistencyWait(input: {
  owner: string;
  repo: string;
  issueNumber: number;
  token: string;
  body: string;
}): Promise<GitHubIssueComment> {
  return await waitForCondition({
    description: `GitHub issue ${String(input.issueNumber)} comment creation`,
    timeoutMs: GitHubIssueCommentConsistencyTimeoutMs,
    evaluate: async () => {
      try {
        return await githubRequestJson({
          method: "POST",
          path: `/repos/${input.owner}/${input.repo}/issues/${String(input.issueNumber)}/comments`,
          token: input.token,
          description: "GitHub issue comment creation",
          schema: GitHubIssueCommentResponseSchema,
          body: {
            body: input.body,
          },
        });
      } catch (error) {
        if (isGitHubIssueCommentNodeConsistencyError(error)) {
          return null;
        }

        throw error;
      }
    },
  });
}

async function closeGitHubIssue(input: {
  owner: string;
  repo: string;
  issueNumber: number;
  token: string;
}): Promise<void> {
  await fetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/issues/${String(input.issueNumber)}`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ state: "closed" }),
    },
  ).catch(() => undefined);
}

export async function waitForCondition<T>(input: {
  description: string;
  timeoutMs: number;
  evaluate: () => Promise<T | null>;
}): Promise<T> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;

  while (Date.now() < deadlineEpochMs) {
    const result = await input.evaluate();
    if (result !== null) {
      return result;
    }

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error(`Timed out waiting for ${input.description} after ${String(input.timeoutMs)}ms.`);
}

export async function waitForGitHubIssueComment(input: {
  owner: string;
  repo: string;
  issueNumber: number;
  token: string;
  expectedSubstring: string;
  timeoutMs: number;
}): Promise<GitHubIssueComment> {
  return waitForCondition({
    description: `GitHub issue comment containing '${input.expectedSubstring}'`,
    timeoutMs: input.timeoutMs,
    evaluate: async () => {
      const comments = await githubRequestJson({
        method: "GET",
        path: `/repos/${input.owner}/${input.repo}/issues/${String(input.issueNumber)}/comments`,
        token: input.token,
        description: "GitHub issue comment listing",
        schema: GitHubIssueCommentListResponseSchema,
      });

      for (let index = comments.length - 1; index >= 0; index -= 1) {
        const comment = comments[index];
        if (comment !== undefined && comment.body.includes(input.expectedSubstring)) {
          return comment;
        }
      }

      return null;
    },
  });
}

export async function waitForCodexPersistedUserMessageText(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  expectedSubstring: string;
  timeoutMs: number;
}): Promise<CodexThreadReadResult> {
  return await waitForCondition({
    description: `Codex persisted user message containing '${input.expectedSubstring}'`,
    timeoutMs: input.timeoutMs,
    evaluate: async () => {
      const result = await readCodexThread({
        rpcClient: input.rpcClient,
        threadId: input.threadId,
      });

      return hasPersistedUserMessageText({
        threadReadResult: result.response,
        expectedSubstring: input.expectedSubstring,
      })
        ? result
        : null;
    },
  });
}

export async function waitForCodexTurnCompleted(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  turnId: string;
  timeoutMs: number;
}): Promise<void> {
  await waitForCondition({
    description: `Codex turn '${input.turnId}' to complete`,
    timeoutMs: input.timeoutMs,
    evaluate: async () => {
      const thread = await readCodexThread({
        rpcClient: input.rpcClient,
        threadId: input.threadId,
      });
      const turn = thread.turns.find((candidate) => candidate.id === input.turnId);
      if (turn === undefined || turn.status === null) {
        return null;
      }

      if (turn.status === "failed") {
        throw new Error(`Codex turn '${input.turnId}' failed.`);
      }

      return turn.status === "completed" ? true : null;
    },
  });
}

export async function triggerGitHubWebhookAutomationFollowUp(input: {
  fixture: SystemTestFixture;
  conversation: GitHubWebhookAutomationConversation;
  followUpMarker: string;
}): Promise<GitHubWebhookAutomationFollowUp> {
  const commentBody = `${input.conversation.payloadMarker}\n${input.followUpMarker}`;

  const issueComment = await githubRequestJson({
    method: "POST",
    path: `/repos/${input.conversation.repository.owner}/${input.conversation.repository.repo}/issues/${String(input.conversation.issueNumber)}/comments`,
    token: input.conversation.githubToken,
    description: "GitHub issue comment creation for follow-up automation",
    schema: GitHubIssueCommentResponseSchema,
    body: {
      body: commentBody,
    },
  });
  if (!issueComment.body.includes(input.followUpMarker)) {
    throw new Error("Expected follow-up GitHub issue comment to persist the follow-up marker.");
  }

  const webhookEvent = await waitForCondition({
    description: "processed GitHub follow-up webhook event",
    timeoutMs: WebhookDeliveryTimeoutMs,
    evaluate: async () => {
      const events = await input.fixture.db.query.integrationWebhookEvents.findMany({
        where: (table, { eq }) => eq(table.targetKey, GitHubTargetKey),
        orderBy: (table, { desc }) => [desc(table.finalizedAt), desc(table.id)],
      });

      for (const event of events) {
        const comment = isRecord(event.payload.comment) ? event.payload.comment : null;
        const body = comment === null ? null : comment.body;
        if (
          event.eventType === "github.issue_comment.created" &&
          typeof body === "string" &&
          body.includes(input.followUpMarker)
        ) {
          if (event.status === "failed") {
            throw new Error(
              `GitHub follow-up webhook event '${event.id}' failed during processing.`,
            );
          }

          return event.status === "processed" ? event : null;
        }
      }

      return null;
    },
  });

  const automationRun = await waitForCondition({
    description: "completed follow-up automation run",
    timeoutMs: AutomationRunTimeoutMs,
    evaluate: async () => {
      const run = await input.fixture.db.query.automationRuns.findFirst({
        where: (table, { eq }) => eq(table.sourceWebhookEventId, webhookEvent.id),
      });

      if (run === undefined) {
        return null;
      }

      if (run.status === AutomationRunStatuses.FAILED) {
        const conversationId = run.conversationId;
        const route =
          conversationId === null
            ? null
            : await input.fixture.db.query.automationConversationRoutes.findFirst({
                where: (table, { eq }) => eq(table.conversationId, conversationId),
              });
        throw new Error(
          `Follow-up automation run failed: ${run.failureCode ?? "unknown"} ${run.failureMessage ?? ""}. route=${JSON.stringify(route)}`,
        );
      }

      return run.status === AutomationRunStatuses.COMPLETED ? run : null;
    },
  });

  if (automationRun.conversationId === null) {
    throw new Error("Expected completed follow-up automation run to persist conversationId.");
  }
  const conversationId = automationRun.conversationId;

  const route = await waitForCondition({
    description: "follow-up automation conversation route",
    timeoutMs: SandboxReadyTimeoutMs,
    evaluate: async () => {
      const persistedRoute = await input.fixture.db.query.automationConversationRoutes.findFirst({
        where: (table, { eq }) => eq(table.conversationId, conversationId),
      });

      if (
        persistedRoute === undefined ||
        persistedRoute.providerConversationId === null ||
        persistedRoute.sandboxInstanceId === null
      ) {
        return null;
      }

      return persistedRoute;
    },
  });
  const providerConversationId = route.providerConversationId;
  const sandboxInstanceId = route.sandboxInstanceId;
  if (providerConversationId === null || sandboxInstanceId === null) {
    throw new Error(
      "Expected follow-up automation conversation route to persist sandbox and provider ids.",
    );
  }

  return {
    automationRunId: automationRun.id,
    conversationId,
    commentBody,
    expectedInputSubstring: input.followUpMarker,
    providerConversationId,
    sandboxInstanceId,
  };
}

function turnContainsCommandExecution(input: {
  items: readonly unknown[];
  expectedCommandSubstring: string;
}): boolean {
  return input.items.some((item) => {
    if (!isRecord(item) || item.type !== "commandExecution") {
      return false;
    }

    return (
      typeof item.command === "string" && item.command.includes(input.expectedCommandSubstring)
    );
  });
}

function describeTurnItems(items: readonly unknown[]): string {
  const descriptions: string[] = [];

  for (const item of items) {
    if (!isRecord(item) || typeof item.type !== "string") {
      continue;
    }

    if (item.type === "commandExecution" && typeof item.command === "string") {
      descriptions.push(`commandExecution:${item.command}`);
      continue;
    }

    if (item.type === "assistantMessage" && Array.isArray(item.content)) {
      const textParts = item.content
        .filter(isRecord)
        .filter((contentItem) => contentItem.type === "text")
        .map((contentItem) => contentItem.text)
        .filter((text): text is string => typeof text === "string");
      if (textParts.length > 0) {
        descriptions.push(`assistantMessage:${textParts.join(" ")}`);
      }
      continue;
    }

    descriptions.push(item.type);
  }

  return descriptions.join(" | ");
}

function readOptionalStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readOptionalNumberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function readObservedCommandExecution(
  notification: CodexNotification,
): ObservedCodexCommandExecution | null {
  if (notification.method !== "item/completed" || !isRecord(notification.params)) {
    return null;
  }

  const item = notification.params.item;
  if (!isRecord(item) || readOptionalStringField(item, "type") !== "commandExecution") {
    return null;
  }

  const command = readOptionalStringField(item, "command");
  if (command === null) {
    return null;
  }

  return {
    command,
    aggregatedOutput: readOptionalStringField(item, "aggregatedOutput"),
    exitCode: readOptionalNumberField(item, "exitCode"),
    status: readOptionalStringField(item, "status"),
  };
}

function readObservedTurnCompletion(
  notification: CodexNotification,
): ObservedCodexTurnCompletion | null {
  if (notification.method !== "turn/completed" || !isRecord(notification.params)) {
    return null;
  }

  const turn = notification.params.turn;
  if (!isRecord(turn)) {
    return null;
  }

  const turnId = readOptionalStringField(turn, "id");
  const status = readOptionalStringField(turn, "status");
  if (turnId === null || status === null) {
    return null;
  }

  const error = turn.error;
  const errorMessage = isRecord(error) ? readOptionalStringField(error, "message") : null;

  return {
    turnId,
    status,
    errorMessage,
  };
}

export function createCodexTurnObserver(input: { rpcClient: CodexJsonRpcClient }): {
  readonly commandExecutions: readonly ObservedCodexCommandExecution[];
  waitForTurnCompleted: (input: { turnId: string; timeoutMs: number }) => Promise<void>;
  dispose: () => void;
} {
  const commandExecutions: ObservedCodexCommandExecution[] = [];
  const completions: ObservedCodexTurnCompletion[] = [];

  const unsubscribe = input.rpcClient.onNotification((notification) => {
    const commandExecution = readObservedCommandExecution(notification);
    if (commandExecution !== null) {
      commandExecutions.push(commandExecution);
    }

    const completion = readObservedTurnCompletion(notification);
    if (completion !== null) {
      completions.push(completion);
    }
  });

  return {
    commandExecutions,
    waitForTurnCompleted: async (waitInput) => {
      const completion = await waitForCondition({
        description: `Codex turn '${waitInput.turnId}' to complete`,
        timeoutMs: waitInput.timeoutMs,
        evaluate: async () => {
          for (let index = completions.length - 1; index >= 0; index -= 1) {
            const candidate = completions[index];
            if (candidate !== undefined && candidate.turnId === waitInput.turnId) {
              return candidate;
            }
          }

          return null;
        },
      });

      if (completion.status === "failed") {
        throw new Error(
          `Codex turn '${waitInput.turnId}' failed: ${completion.errorMessage ?? "no error message"}`,
        );
      }
    },
    dispose: unsubscribe,
  };
}

export async function waitForCodexCommandExecution(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  turnId: string;
  expectedCommandSubstring: string;
  timeoutMs: number;
}): Promise<void> {
  try {
    await waitForCondition({
      description: `Codex turn '${input.turnId}' to execute '${input.expectedCommandSubstring}'`,
      timeoutMs: input.timeoutMs,
      evaluate: async () => {
        const thread = await readCodexThread({
          rpcClient: input.rpcClient,
          threadId: input.threadId,
        });
        const turn = thread.turns.find((candidate) => candidate.id === input.turnId);
        if (turn === undefined) {
          return null;
        }

        if (
          turnContainsCommandExecution({
            items: turn.items,
            expectedCommandSubstring: input.expectedCommandSubstring,
          })
        ) {
          return true;
        }

        if (turn.status === "completed" || turn.status === "failed") {
          throw new Error(
            `Codex turn '${input.turnId}' completed without executing '${input.expectedCommandSubstring}'. items=${describeTurnItems(turn.items)}`,
          );
        }

        return null;
      },
    });
  } catch (error) {
    const thread = await readCodexThread({
      rpcClient: input.rpcClient,
      threadId: input.threadId,
    });
    const turn = thread.turns.find((candidate) => candidate.id === input.turnId);
    const turnSummary =
      turn === undefined
        ? "turn missing from thread"
        : `status=${turn.status ?? "null"} items=${describeTurnItems(turn.items)}`;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} ${turnSummary}`.trim(),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPersistedUserMessageText(input: {
  threadReadResult: unknown;
  expectedSubstring: string;
}): boolean {
  if (!isRecord(input.threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }

  const thread = input.threadReadResult.thread;
  if (!isRecord(thread) || !Array.isArray(thread.turns)) {
    throw new Error("thread/read result.thread.turns must be an array.");
  }

  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = thread.turns[turnIndex];
    if (!isRecord(turn) || !Array.isArray(turn.items)) {
      continue;
    }

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!isRecord(item) || item.type !== "userMessage" || !Array.isArray(item.content)) {
        continue;
      }

      for (const contentItem of item.content) {
        if (!isRecord(contentItem)) {
          continue;
        }

        if (contentItem.type !== "text" || typeof contentItem.text !== "string") {
          continue;
        }

        if (contentItem.text.includes(input.expectedSubstring)) {
          return true;
        }
      }
    }
  }

  return false;
}

function hasAssistantMessageText(input: {
  threadReadResult: unknown;
  expectedSubstring: string;
}): boolean {
  return collectAssistantMessageTexts(input.threadReadResult).some((text) =>
    text.includes(input.expectedSubstring),
  );
}

function collectAssistantMessageTexts(threadReadResult: unknown): string[] {
  const assistantTexts: string[] = [];

  if (!isRecord(threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }

  const thread = threadReadResult.thread;
  if (!isRecord(thread) || !Array.isArray(thread.turns)) {
    throw new Error("thread/read result.thread.turns must be an array.");
  }

  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = thread.turns[turnIndex];
    if (!isRecord(turn) || !Array.isArray(turn.items)) {
      continue;
    }

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!isRecord(item) || item.type !== "assistantMessage" || !Array.isArray(item.content)) {
        continue;
      }

      for (const contentItem of item.content) {
        if (!isRecord(contentItem)) {
          continue;
        }

        if (contentItem.type !== "text" || typeof contentItem.text !== "string") {
          continue;
        }

        assistantTexts.push(contentItem.text);
      }
    }
  }

  return assistantTexts;
}

export async function waitForCodexAssistantMessageText(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  expectedSubstring: string;
  timeoutMs: number;
}): Promise<CodexThreadReadResult> {
  let lastAssistantTexts: string[] = [];

  try {
    return await waitForCondition({
      description: `Codex assistant message containing '${input.expectedSubstring}'`,
      timeoutMs: input.timeoutMs,
      evaluate: async () => {
        const result = await readCodexThread({
          rpcClient: input.rpcClient,
          threadId: input.threadId,
        });

        lastAssistantTexts = collectAssistantMessageTexts(result.response);

        return hasAssistantMessageText({
          threadReadResult: result.response,
          expectedSubstring: input.expectedSubstring,
        })
          ? result
          : null;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Timed out waiting for ")) {
      const recentAssistantTexts = lastAssistantTexts
        .slice(0, 3)
        .map((text) => JSON.stringify(text))
        .join(", ");
      const suffix =
        recentAssistantTexts.length === 0
          ? " No assistant text messages were observed."
          : ` Recent assistant texts: ${recentAssistantTexts}`;
      throw new Error(`${error.message}${suffix}`);
    }

    throw error;
  }
}

async function createOpenAiConnection(input: {
  fixture: SystemTestFixture;
  session: AuthenticatedSession;
  openAiApiKey: string;
}): Promise<string> {
  const connection = await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/integration/connections/${encodeURIComponent(OpenAiTargetKey)}/form`,
    expectedStatus: 201,
    description: "OpenAI connection creation",
    schema: IntegrationConnectionResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        displayName: `GitHub Webhook Test OpenAI ${randomUUID()}`,
        methodId: OpenAiConnectionMethodId,
        config: {
          connection_method: OpenAiConnectionMethodId,
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
  fixture: SystemTestFixture;
  session: AuthenticatedSession;
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
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        displayName: `GitHub Webhook System Test ${randomUUID()}`,
      }),
    },
  });

  return sandboxProfile.id;
}

async function putSandboxBindings(input: {
  fixture: SystemTestFixture;
  session: AuthenticatedSession;
  sandboxProfileId: string;
  bindings: unknown[];
  description: string;
}): Promise<void> {
  await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/sandbox/profiles/${encodeURIComponent(input.sandboxProfileId)}/versions/1/integration-bindings`,
    expectedStatus: 200,
    description: input.description,
    schema: z.object({
      bindings: z.array(z.unknown()),
    }),
    init: {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        bindings: input.bindings,
      }),
    },
  });
}

async function createGitHubConnection(input: {
  fixture: SystemTestFixture;
  session: AuthenticatedSession;
  githubAppId: string;
  githubAppSlug: string;
  githubAppClientId: string;
  githubAppClientSecret: string;
  githubAppPrivateKeyPem: string;
  githubWebhookSecret: string;
}): Promise<string> {
  const connection = await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/integration/connections/${encodeURIComponent(GitHubTargetKey)}/form`,
    expectedStatus: 201,
    description: "GitHub connection creation",
    schema: IntegrationConnectionResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        displayName: `GitHub Webhook Test GitHub ${randomUUID()}`,
        methodId: GitHubConnectionMethodId,
        config: {
          connection_method: GitHubConnectionMethodId,
          app_id: input.githubAppId,
          app_slug: input.githubAppSlug,
          client_id: input.githubAppClientId,
        },
        secrets: {
          appPrivateKeyPem: input.githubAppPrivateKeyPem,
          clientSecret: input.githubAppClientSecret,
          webhookSecret: input.githubWebhookSecret,
        },
      }),
    },
  });

  return connection.id;
}

async function completeGitHubInstallation(input: {
  fixture: SystemTestFixture;
  session: AuthenticatedSession;
  githubConnectionId: string;
  githubInstallationId: string;
}): Promise<void> {
  const githubOauthStart = await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/integration/connections/${encodeURIComponent(input.githubConnectionId)}/github-app-installation/start`,
    expectedStatus: 200,
    description: "GitHub App installation start",
    schema: StartRedirectConnectionResponseSchema,
    init: {
      method: "POST",
      headers: {
        cookie: input.session.cookie,
      },
    },
  });
  const githubOauthState = new URL(githubOauthStart.authorizationUrl).searchParams.get("state");
  if (githubOauthState === null || githubOauthState.length === 0) {
    throw new Error("Expected GitHub App installation start response to include a state.");
  }

  const githubAppInstallationCompleteResponse = await input.fixture.request(
    createGitHubAppInstallationCompletePath({
      query: {
        state: githubOauthState,
        installation_id: input.githubInstallationId,
        setup_action: "install",
      },
    }),
    {
      method: "GET",
      headers: {
        cookie: input.session.cookie,
      },
      redirect: "manual",
    },
  );
  if (githubAppInstallationCompleteResponse.status !== 302) {
    const errorBody = await githubAppInstallationCompleteResponse.text().catch(() => "");
    throw new Error(
      `GitHub App installation completion expected status 302, got ${String(githubAppInstallationCompleteResponse.status)}. Response body: ${errorBody}`,
    );
  }

  await waitForCondition({
    description: "persisted GitHub connection installation to be completed",
    timeoutMs: AutomationRunTimeoutMs,
    evaluate: async () => {
      const connection = await input.fixture.db.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.id, input.githubConnectionId),
            eq(table.organizationId, input.session.organizationId),
            eq(table.externalSubjectId, input.githubInstallationId),
          ),
      });

      return connection ?? null;
    },
  });
}

async function refreshGitHubRepositoryResource(input: {
  fixture: SystemTestFixture;
  session: AuthenticatedSession;
  githubConnectionId: string;
  repository: GitHubRepository;
}): Promise<void> {
  await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/integration/connections/${encodeURIComponent(input.githubConnectionId)}/resources/repository/refresh`,
    expectedStatus: 202,
    description: "GitHub repository resource refresh",
    schema: RefreshIntegrationConnectionResourcesResponseSchema,
    init: {
      method: "POST",
      headers: {
        cookie: input.session.cookie,
      },
    },
  });

  await waitForCondition({
    description: "GitHub repository resource sync to reach ready",
    timeoutMs: ResourceSyncTimeoutMs,
    evaluate: async () => {
      const resourceState =
        await input.fixture.db.query.integrationConnectionResourceStates.findFirst({
          where: (table, { and, eq }) =>
            and(eq(table.connectionId, input.githubConnectionId), eq(table.kind, "repository")),
        });

      if (resourceState === undefined) {
        return null;
      }

      if (resourceState.syncState === "error") {
        throw new Error(
          `GitHub resource sync failed: ${resourceState.lastErrorCode ?? "unknown"} ${resourceState.lastErrorMessage ?? ""}`,
        );
      }

      if (resourceState.syncState !== "ready") {
        return null;
      }

      const resource = await input.fixture.db.query.integrationConnectionResources.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, input.githubConnectionId),
            eq(table.kind, "repository"),
            eq(table.handle, `${input.repository.owner}/${input.repository.repo}`),
          ),
      });

      return resource === undefined ? null : resource;
    },
  });
}

async function readGitHubWebhookSource(input: {
  fixture: SystemTestFixture;
  session: AuthenticatedSession;
  githubConnectionId: string;
}): Promise<GitHubWebhookSource> {
  const githubWebhookSources = await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/integration/connections/${encodeURIComponent(input.githubConnectionId)}/webhook-sources`,
    expectedStatus: 200,
    description: "GitHub webhook source listing",
    schema: z.array(IntegrationWebhookSourceResponseSchema),
    init: {
      method: "GET",
      headers: {
        cookie: input.session.cookie,
      },
    },
  });

  const githubWebhookSource = githubWebhookSources.find(
    (source) =>
      source.targetKey === GitHubTargetKey &&
      source.integrationConnectionId === input.githubConnectionId,
  );
  if (githubWebhookSource === undefined) {
    throw new Error(
      `Expected an implicit connection-owned GitHub webhook source for connection '${input.githubConnectionId}'. Sources: ${JSON.stringify(githubWebhookSources)}`,
    );
  }

  return githubWebhookSource;
}

async function createWebhookAutomation(input: {
  fixture: SystemTestFixture;
  session: AuthenticatedSession;
  githubWebhookSource: GitHubWebhookSource;
  sandboxProfileId: string;
  payloadMarker: string;
  instructions?: string;
}): Promise<void> {
  const automation = await requestJsonOrThrow({
    request: input.fixture.request,
    path: "/v1/automations/webhooks",
    expectedStatus: 201,
    description: "webhook automation creation",
    schema: WebhookAutomationResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        name: `GitHub Webhook Automation ${randomUUID()}`,
        enabled: true,
        integrationWebhookSourceId: input.githubWebhookSource.id,
        eventTypes: ["github.issue_comment.created"],
        payloadFilter: {
          "github.issue_comment.created": {
            op: "contains",
            path: ["comment", "body"],
            value: input.payloadMarker,
          },
        },
        inputTemplate: "GitHub issue comment webhook: {{payload.comment.body}}",
        instructions: input.instructions ?? null,
        conversationKeyTemplate: "github-issue-{{payload.issue.number}}",
        idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
        target: {
          sandboxProfileId: input.sandboxProfileId,
          sandboxProfileVersion: 1,
        },
      }),
    },
  });

  if (automation.id.length === 0) {
    throw new Error("Expected webhook automation creation to persist a non-empty id.");
  }
}

export async function startGitHubWebhookAutomationConversation(input: {
  fixture: SystemTestFixture;
  automationInstructions?: string;
}): Promise<GitHubWebhookAutomationConversation> {
  const repository = parseGitHubRepository(
    requireGitHubWebhookAutomationEnv("MISTLE_TEST_GITHUB_TEST_REPOSITORY"),
  );
  const githubToken = requireGitHubWebhookAutomationEnv("MISTLE_TEST_GITHUB_TOKEN");
  const githubAppId = requireGitHubWebhookAutomationEnv("MISTLE_TEST_GITHUB_APP_ID");
  const githubAppSlug = requireGitHubWebhookAutomationEnv("MISTLE_TEST_GITHUB_APP_SLUG");
  const githubAppClientId = requireGitHubWebhookAutomationEnv("MISTLE_TEST_GITHUB_APP_CLIENT_ID");
  const githubAppClientSecret = requireGitHubWebhookAutomationEnv(
    "MISTLE_TEST_GITHUB_APP_CLIENT_SECRET",
  );
  const githubAppPrivateKeyPem = requireGitHubWebhookAutomationEnv(
    "MISTLE_TEST_GITHUB_APP_PRIVATE_KEY_PEM",
  );
  const githubWebhookSecret = requireGitHubWebhookAutomationEnv(
    "MISTLE_TEST_GITHUB_WEBHOOK_SECRET",
  );
  const openAiApiKey = requireGitHubWebhookAutomationEnv("MISTLE_TEST_OPENAI_API_KEY");
  const dataPlaneGatewayBaseUrl = input.fixture.dataPlaneGatewayBaseUrl;
  const publicHostname = requireGitHubWebhookAutomationEnv("CONTROL_PLANE_API_TUNNEL_HOSTNAME");
  const githubInstallationId = await resolveGitHubAppInstallationId({
    owner: repository.owner,
    repo: repository.repo,
    targetKey: GitHubTargetKey,
  });
  const payloadMarker = `mistle-system-webhook-${randomUUID()}`;
  const expectedInputSubstring = `GitHub issue comment webhook: ${payloadMarker}`;
  const session = await input.fixture.authSession();

  let githubConnectionId: string | null = null;
  let issueNumber: number | null = null;
  let sessionClient: AgentStreamClient | null = null;
  let sessionTransport: SandboxSessionTransport | null = null;
  let rpcClient: CodexJsonRpcClient | null = null;
  let originalGitHubAppWebhookConfig: {
    url: string;
    contentType?: string;
    insecureSsl?: string;
  } | null = null;
  let didCleanup = false;
  let conversation: GitHubWebhookAutomationConversation | null = null;

  async function cleanup(): Promise<void> {
    if (didCleanup) {
      return;
    }
    didCleanup = true;

    if (originalGitHubAppWebhookConfig !== null) {
      await updateGitHubAppWebhookConfig({
        url: originalGitHubAppWebhookConfig.url,
        ...(originalGitHubAppWebhookConfig.contentType === undefined
          ? {}
          : { contentType: originalGitHubAppWebhookConfig.contentType }),
        ...(originalGitHubAppWebhookConfig.insecureSsl === undefined
          ? {}
          : { insecureSsl: originalGitHubAppWebhookConfig.insecureSsl }),
      }).catch(() => undefined);
    }

    rpcClient?.dispose();
    sessionClient?.disconnect();
    sessionTransport?.disconnect(1000, "System test cleanup.");

    if (issueNumber !== null) {
      await closeGitHubIssue({
        owner: repository.owner,
        repo: repository.repo,
        issueNumber,
        token: githubToken,
      });
    }
  }

  async function connectRpcClient(connectionInput: {
    sandboxInstanceId: string;
    dataPlaneGatewayBaseUrl: string;
  }): Promise<CodexJsonRpcClient> {
    rpcClient?.dispose();
    rpcClient = null;
    if (sessionClient !== null) {
      sessionClient.disconnect();
      sessionClient = null;
    }
    if (sessionTransport !== null) {
      sessionTransport.disconnect(1000, "System test reconnect.");
      sessionTransport = null;
    }

    const mintedConnectionToken = await requestJsonOrThrow({
      request: input.fixture.request,
      path: `/v1/sandbox/instances/${encodeURIComponent(connectionInput.sandboxInstanceId)}/connection-tokens`,
      expectedStatus: 201,
      description: "sandbox connection token minting",
      schema: SandboxInstanceConnectionTokenResponseSchema,
      init: {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    });

    sessionTransport = new SandboxSessionTransport({
      runtime: createNodeSandboxSessionRuntime(),
    });
    await sessionTransport.connect({
      connectionUrl: resolveGatewayWebSocketUrl({
        mintedUrl: mintedConnectionToken.url,
        gatewayBaseUrl: connectionInput.dataPlaneGatewayBaseUrl,
      }),
    });
    sessionClient = new AgentStreamClient({
      transport: sessionTransport,
    });
    await sessionClient.connect();

    const connectedRpcClient = new CodexJsonRpcClient(sessionClient);
    rpcClient = connectedRpcClient;
    await connectedRpcClient.initialize({
      clientInfo: {
        name: "mistle-system-tests",
        version: "0.1.0",
      },
    });
    if (conversation !== null) {
      conversation.rpcClient = connectedRpcClient;
    }

    return connectedRpcClient;
  }

  try {
    const openAiConnectionId = await createOpenAiConnection({
      fixture: input.fixture,
      session,
      openAiApiKey,
    });
    const sandboxProfileId = await createSandboxProfile({
      fixture: input.fixture,
      session,
    });

    await putSandboxBindings({
      fixture: input.fixture,
      session,
      sandboxProfileId,
      description: "sandbox profile integration binding update",
      bindings: [
        {
          connectionId: openAiConnectionId,
          kind: "agent",
          config: {
            runtime: {
              runtimeId: "codex",
              config: {},
            },
            model: {
              defaultModel: "gpt-5.1-codex-mini",
              options: {
                reasoningEffort: "medium",
              },
            },
          },
        },
      ],
    });

    githubConnectionId = await createGitHubConnection({
      fixture: input.fixture,
      session,
      githubAppId,
      githubAppSlug,
      githubAppClientId,
      githubAppClientSecret,
      githubAppPrivateKeyPem,
      githubWebhookSecret,
    });

    await completeGitHubInstallation({
      fixture: input.fixture,
      session,
      githubConnectionId,
      githubInstallationId,
    });

    await refreshGitHubRepositoryResource({
      fixture: input.fixture,
      session,
      githubConnectionId,
      repository,
    });

    const githubWebhookSource = await readGitHubWebhookSource({
      fixture: input.fixture,
      session,
      githubConnectionId,
    });

    await putSandboxBindings({
      fixture: input.fixture,
      session,
      sandboxProfileId,
      description: "sandbox profile integration binding update after GitHub connection",
      bindings: [
        {
          connectionId: openAiConnectionId,
          kind: "agent",
          config: {
            runtime: {
              runtimeId: "codex",
              config: {},
            },
            model: {
              defaultModel: "gpt-5.1-codex-mini",
              options: {
                reasoningEffort: "medium",
              },
            },
          },
        },
        {
          connectionId: githubConnectionId,
          kind: "git",
          config: {
            repositories: [`${repository.owner}/${repository.repo}`],
            tools: ["github-cli"],
          },
        },
      ],
    });

    await createWebhookAutomation({
      fixture: input.fixture,
      session,
      githubWebhookSource,
      sandboxProfileId,
      payloadMarker,
      ...(input.automationInstructions === undefined
        ? {}
        : { instructions: input.automationInstructions }),
    });

    originalGitHubAppWebhookConfig = await readGitHubAppWebhookConfig();
    await updateGitHubAppWebhookConfig({
      url: buildGitHubWebhookCallbackUrl({
        publicHostname,
        targetKey: GitHubTargetKey,
        endpointKey: githubWebhookSource.endpointKey,
      }),
      ...(originalGitHubAppWebhookConfig.contentType === undefined
        ? {}
        : { contentType: originalGitHubAppWebhookConfig.contentType }),
      ...(originalGitHubAppWebhookConfig.insecureSsl === undefined
        ? {}
        : { insecureSsl: originalGitHubAppWebhookConfig.insecureSsl }),
    });

    const issue = await githubRequestJson({
      method: "POST",
      path: `/repos/${repository.owner}/${repository.repo}/issues`,
      token: githubToken,
      description: "GitHub issue creation",
      schema: GitHubIssueResponseSchema,
      body: {
        title: `Webhook automation system test ${payloadMarker}`,
        body: `Webhook automation system test issue ${payloadMarker}`,
      },
    });
    issueNumber = issue.number;

    const issueComment = await createGitHubIssueCommentWithConsistencyWait({
      owner: repository.owner,
      repo: repository.repo,
      issueNumber: issue.number,
      token: githubToken,
      body: payloadMarker,
    });
    if (!issueComment.body.includes(payloadMarker)) {
      throw new Error("Expected GitHub issue comment creation to persist the webhook marker.");
    }

    const webhookEvent = await waitForCondition({
      description: "processed GitHub webhook event",
      timeoutMs: WebhookDeliveryTimeoutMs,
      evaluate: async () => {
        const events = await input.fixture.db.query.integrationWebhookEvents.findMany({
          where: (table, { and, eq }) =>
            and(
              eq(table.targetKey, GitHubTargetKey),
              eq(table.integrationWebhookSourceId, githubWebhookSource.id),
            ),
          orderBy: (table, { desc }) => [desc(table.finalizedAt), desc(table.id)],
        });

        for (const event of events) {
          const comment = isRecord(event.payload.comment) ? event.payload.comment : null;
          const body = comment === null ? null : comment.body;
          if (
            event.eventType === "github.issue_comment.created" &&
            typeof body === "string" &&
            body.includes(payloadMarker)
          ) {
            if (event.status === "failed") {
              throw new Error(`GitHub webhook event '${event.id}' failed during processing.`);
            }

            return event.status === "processed" ? event : null;
          }
        }

        return null;
      },
    });

    const automationRun = await waitForCondition({
      description: "completed automation run",
      timeoutMs: AutomationRunTimeoutMs,
      evaluate: async () => {
        const run = await input.fixture.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.sourceWebhookEventId, webhookEvent.id),
        });

        if (run === undefined) {
          return null;
        }

        if (run.status === AutomationRunStatuses.FAILED) {
          const conversationId = run.conversationId;
          const route =
            conversationId === null
              ? null
              : await input.fixture.db.query.automationConversationRoutes.findFirst({
                  where: (table, { eq }) => eq(table.conversationId, conversationId),
                });
          const sandboxInstance =
            route?.sandboxInstanceId === null || route?.sandboxInstanceId === undefined
              ? null
              : await requestJsonOrThrow({
                  request: input.fixture.request,
                  path: `/v1/sandbox/instances/${encodeURIComponent(route.sandboxInstanceId)}`,
                  expectedStatus: 200,
                  description: "sandbox instance lookup after automation failure",
                  schema: SandboxInstanceStatusResponseSchema,
                  init: {
                    method: "GET",
                    headers: {
                      cookie: session.cookie,
                    },
                  },
                });
          throw new Error(
            `Automation run failed: ${run.failureCode ?? "unknown"} ${run.failureMessage ?? ""}. route=${JSON.stringify(route)} sandbox=${JSON.stringify(sandboxInstance)}`,
          );
        }

        return run.status === AutomationRunStatuses.COMPLETED ? run : null;
      },
    });
    if (automationRun.conversationId === null) {
      throw new Error("Expected completed automation run to persist conversationId.");
    }
    const conversationId = automationRun.conversationId;

    const route = await waitForCondition({
      description: "active automation conversation route",
      timeoutMs: SandboxReadyTimeoutMs,
      evaluate: async () => {
        const persistedRoute = await input.fixture.db.query.automationConversationRoutes.findFirst({
          where: (table, { eq }) => eq(table.conversationId, conversationId),
        });

        if (persistedRoute === undefined || persistedRoute.providerConversationId === null) {
          return null;
        }

        return persistedRoute;
      },
    });
    if (route.providerConversationId === null) {
      throw new Error("Expected automation conversation route to persist providerConversationId.");
    }
    const providerConversationId = route.providerConversationId;

    const sandboxInstance = await waitForCondition({
      description: "running sandbox instance",
      timeoutMs: SandboxReadyTimeoutMs,
      evaluate: async () => {
        const response = await input.fixture.request(
          `/v1/sandbox/instances/${encodeURIComponent(route.sandboxInstanceId)}`,
          {
            headers: {
              cookie: session.cookie,
            },
          },
        );

        const bodyText = await response.text().catch(() => "");
        if (response.status !== 200) {
          throw new Error(
            `sandbox instance status lookup failed with status ${String(response.status)}. Response body: ${bodyText}`,
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(bodyText);
        } catch (error) {
          throw new Error(
            `sandbox instance status lookup returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        const status = SandboxInstanceStatusResponseSchema.parse(parsed);
        if (status.status === "failed" || status.status === "stopped") {
          throw new Error(
            `Sandbox instance '${status.id}' entered terminal status '${status.status}': ${status.failureMessage ?? "no failure message"}`,
          );
        }

        return status.status === "running" ? status : null;
      },
    });

    const connectedRpcClient = await connectRpcClient({
      sandboxInstanceId: route.sandboxInstanceId,
      dataPlaneGatewayBaseUrl,
    });

    await resumeCodexThread({
      rpcClient: connectedRpcClient,
      threadId: providerConversationId,
    });

    const initialThreadRead = await waitForCondition({
      description: "automation conversation thread containing webhook input",
      timeoutMs: ThreadReadTimeoutMs,
      evaluate: async () => {
        const result = await readCodexThread({
          rpcClient: connectedRpcClient,
          threadId: providerConversationId,
        });

        return hasPersistedUserMessageText({
          threadReadResult: result.response,
          expectedSubstring: expectedInputSubstring,
        })
          ? result
          : null;
      },
    });

    if (sandboxInstance.id !== route.sandboxInstanceId) {
      throw new Error("Expected running sandbox instance id to match conversation route.");
    }

    conversation = {
      automationRunId: automationRun.id,
      conversationId,
      automationInstructionsSnapshot: automationRun.instructions,
      issueNumber,
      payloadMarker,
      expectedInputSubstring,
      providerConversationId,
      sandboxInstanceId: route.sandboxInstanceId,
      repository,
      githubToken,
      rpcClient: connectedRpcClient,
      initialThreadRead,
      buildExpectedSessionLinkUrl: () =>
        buildSandboxSessionLinkUrl({
          publicHostname,
          sandboxInstanceId: route.sandboxInstanceId,
        }),
      reconnectRpcClient: async () =>
        await connectRpcClient({
          sandboxInstanceId: route.sandboxInstanceId,
          dataPlaneGatewayBaseUrl,
        }),
      cleanup,
    };
    return conversation;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
