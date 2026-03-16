/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import {
  CodexJsonRpcClient,
  CodexSessionClient,
  readCodexThread,
  resumeCodexThread,
} from "@mistle/codex-app-server-client";
import { createNodeCodexSessionRuntime } from "@mistle/codex-app-server-client/node";
import { AutomationRunStatuses } from "@mistle/db/control-plane";
import { systemSleeper } from "@mistle/time";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { z } from "zod";

import {
  startCloudflaredTunnel,
  type StartedCloudflaredTunnel,
} from "./helpers/cloudflared-tunnel.js";
import { it, readSystemTestContext } from "./system-test-context.js";

const OpenAiTargetKey = "openai-default";
const GitHubTargetKey = "github-cloud";
const TestTimeoutMs = 10 * 60_000;
const TunnelStartupTimeoutMs = 60_000;
const PollIntervalMs = 2_000;
const SandboxReadyTimeoutMs = 3 * 60_000;
const WebhookDeliveryTimeoutMs = 3 * 60_000;
const AutomationRunTimeoutMs = 3 * 60_000;
const ThreadReadTimeoutMs = 90_000;

const RequiredEnvNames = [
  "MISTLE_TEST_OPENAI_API_KEY",
  "MISTLE_TEST_GITHUB_TOKEN",
  "MISTLE_TEST_GITHUB_TEST_REPOSITORY",
  "MISTLE_TEST_GITHUB_INSTALLATION_ID",
  "CLOUDFLARE_TUNNEL_TOKEN",
  "CONTROL_PLANE_API_TUNNEL_HOSTNAME",
] as const;

const IntegrationConnectionResponseSchema = z.looseObject({
  id: z.string().min(1),
});

const SandboxProfileResponseSchema = z.looseObject({
  id: z.string().min(1),
});

const WebhookAutomationResponseSchema = z.looseObject({
  id: z.string().min(1),
});

const StartOAuthConnectionResponseSchema = z
  .object({
    authorizationUrl: z.url(),
  })
  .strict();

const SandboxInstanceStatusResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["starting", "running", "stopped", "failed"]),
    failureCode: z.string().nullable(),
    failureMessage: z.string().nullable(),
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

const GitHubIssueResponseSchema = z.looseObject({
  number: z.number().int().positive(),
});

const GitHubIssueCommentResponseSchema = z.looseObject({
  id: z.number().int().positive(),
  body: z.string().min(1),
});

function hasRequiredEnv(): boolean {
  return RequiredEnvNames.every((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.length > 0;
  });
}

function requireEnv(name: (typeof RequiredEnvNames)[number]): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseGitHubRepository(input: string): { owner: string; repo: string } {
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

function createOAuthCompletePath(input: {
  targetKey: string;
  query: Record<string, string>;
}): string {
  const searchParams = new URLSearchParams(input.query);
  return `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth/complete?${searchParams.toString()}`;
}

function resolveControlPlaneApiLocalPort(controlPlaneApiBaseUrl: string): number {
  const baseUrl = new URL(controlPlaneApiBaseUrl);
  const parsedPort = Number.parseInt(baseUrl.port, 10);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error("Control plane API base URL must include a positive numeric port.");
  }

  return parsedPort;
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

async function waitForCondition<T>(input: {
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

type GitHubWebhookTestObject = {
  [key: string]: unknown;
};

function isGitHubWebhookTestObject(value: unknown): value is GitHubWebhookTestObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPersistedUserMessageText(input: {
  threadReadResult: unknown;
  expectedSubstring: string;
}): boolean {
  if (!isGitHubWebhookTestObject(input.threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }

  const thread = input.threadReadResult.thread;
  if (!isGitHubWebhookTestObject(thread) || !Array.isArray(thread.turns)) {
    throw new Error("thread/read result.thread.turns must be an array.");
  }

  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = thread.turns[turnIndex];
    if (!isGitHubWebhookTestObject(turn) || !Array.isArray(turn.items)) {
      continue;
    }

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (
        !isGitHubWebhookTestObject(item) ||
        item.type !== "userMessage" ||
        !Array.isArray(item.content)
      ) {
        continue;
      }

      for (const contentItem of item.content) {
        if (!isGitHubWebhookTestObject(contentItem)) {
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

const describeIf = hasRequiredEnv() ? describe : describe.skip;

describeIf("system GitHub webhook automation", () => {
  let tunnel: StartedCloudflaredTunnel | null = null;

  beforeAll(async () => {
    const systemTestContext = await readSystemTestContext();
    tunnel = await startCloudflaredTunnel({
      tunnelToken: requireEnv("CLOUDFLARE_TUNNEL_TOKEN"),
      publicHostname: requireEnv("CONTROL_PLANE_API_TUNNEL_HOSTNAME"),
      targetLocalPort: resolveControlPlaneApiLocalPort(systemTestContext.controlPlaneApiBaseUrl),
      startupTimeoutMs: TunnelStartupTimeoutMs,
    });
  }, TunnelStartupTimeoutMs + 30_000);

  afterAll(async () => {
    if (tunnel !== null) {
      await tunnel.stop();
    }
  });

  it(
    "routes a real GitHub issue comment webhook into an automation conversation thread",
    async ({ fixture }) => {
      const repository = parseGitHubRepository(requireEnv("MISTLE_TEST_GITHUB_TEST_REPOSITORY"));
      const githubToken = requireEnv("MISTLE_TEST_GITHUB_TOKEN");
      const githubInstallationId = requireEnv("MISTLE_TEST_GITHUB_INSTALLATION_ID");
      const openAiApiKey = requireEnv("MISTLE_TEST_OPENAI_API_KEY");
      const dataPlaneGatewayBaseUrl = fixture.dataPlaneGatewayBaseUrl;

      const payloadMarker = `mistle-system-webhook-${randomUUID()}`;
      const expectedInputSubstring = `GitHub issue comment webhook: ${payloadMarker}`;
      const session = await fixture.authSession();
      const openAiConnection = await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/integration/connections/${encodeURIComponent(OpenAiTargetKey)}/api-key`,
        expectedStatus: 201,
        description: "OpenAI connection creation",
        schema: IntegrationConnectionResponseSchema,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify({
            apiKey: openAiApiKey,
            displayName: `GitHub Webhook Test OpenAI ${randomUUID()}`,
          }),
        },
      });

      const sandboxProfile = await requestJsonOrThrow({
        request: fixture.request,
        path: "/v1/sandbox/profiles",
        expectedStatus: 201,
        description: "sandbox profile creation",
        schema: SandboxProfileResponseSchema,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify({
            displayName: `GitHub Webhook System Test ${randomUUID()}`,
          }),
        },
      });

      await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/sandbox/profiles/${encodeURIComponent(sandboxProfile.id)}/versions/1/integration-bindings`,
        expectedStatus: 200,
        description: "sandbox profile integration binding update",
        schema: z.object({
          bindings: z.array(z.unknown()),
        }),
        init: {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify({
            bindings: [
              {
                connectionId: openAiConnection.id,
                kind: "agent",
                config: {
                  runtime: "codex-cli",
                  defaultModel: "gpt-5.1-codex-mini",
                  reasoningEffort: "medium",
                },
              },
            ],
          }),
        },
      });

      const githubOauthStart = await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/integration/connections/${encodeURIComponent(GitHubTargetKey)}/oauth/start`,
        expectedStatus: 200,
        description: "GitHub OAuth connection start",
        schema: StartOAuthConnectionResponseSchema,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify({
            displayName: `GitHub Webhook Test GitHub ${randomUUID()}`,
          }),
        },
      });
      const githubOauthState = new URL(githubOauthStart.authorizationUrl).searchParams.get("state");
      if (githubOauthState === null || githubOauthState.length === 0) {
        throw new Error("Expected GitHub OAuth start response to include a non-empty state.");
      }

      const githubOAuthCompleteResponse = await fixture.request(
        createOAuthCompletePath({
          targetKey: GitHubTargetKey,
          query: {
            state: githubOauthState,
            installation_id: githubInstallationId,
            setup_action: "install",
          },
        }),
        {
          method: "GET",
          headers: {
            cookie: session.cookie,
          },
          redirect: "manual",
        },
      );
      if (githubOAuthCompleteResponse.status !== 302) {
        const errorBody = await githubOAuthCompleteResponse.text().catch(() => "");
        throw new Error(
          `GitHub OAuth connection completion expected status 302, got ${String(githubOAuthCompleteResponse.status)}. Response body: ${errorBody}`,
        );
      }
      const githubConnection = await waitForCondition({
        description: "persisted GitHub connection to be created",
        timeoutMs: AutomationRunTimeoutMs,
        evaluate: async () => {
          return (
            (await fixture.db.query.integrationConnections.findFirst({
              where: (table, { and, eq }) =>
                and(
                  eq(table.organizationId, session.organizationId),
                  eq(table.targetKey, GitHubTargetKey),
                  eq(table.externalSubjectId, githubInstallationId),
                ),
            })) ?? null
          );
        },
      });

      const automation = await requestJsonOrThrow({
        request: fixture.request,
        path: "/v1/automations/webhooks",
        expectedStatus: 201,
        description: "webhook automation creation",
        schema: WebhookAutomationResponseSchema,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify({
            name: `GitHub Webhook Automation ${randomUUID()}`,
            enabled: true,
            integrationConnectionId: githubConnection.id,
            eventTypes: ["github.issue_comment.created"],
            payloadFilter: {
              op: "contains",
              path: ["comment", "body"],
              value: payloadMarker,
            },
            inputTemplate: "GitHub issue comment webhook: {{payload.comment.body}}",
            conversationKeyTemplate: "github-issue-{{payload.issue.number}}",
            idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
            target: {
              sandboxProfileId: sandboxProfile.id,
              sandboxProfileVersion: 1,
            },
          }),
        },
      });
      expect(automation.id.length).toBeGreaterThan(0);

      let issueNumber: number | null = null;
      let sessionClient: CodexSessionClient | null = null;
      let rpcClient: CodexJsonRpcClient | null = null;

      try {
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

        const issueComment = await githubRequestJson({
          method: "POST",
          path: `/repos/${repository.owner}/${repository.repo}/issues/${String(issue.number)}/comments`,
          token: githubToken,
          description: "GitHub issue comment creation",
          schema: GitHubIssueCommentResponseSchema,
          body: {
            body: payloadMarker,
          },
        });
        expect(issueComment.body).toContain(payloadMarker);

        const webhookEvent = await waitForCondition({
          description: "processed GitHub webhook event",
          timeoutMs: WebhookDeliveryTimeoutMs,
          evaluate: async () => {
            const events = await fixture.db.query.integrationWebhookEvents.findMany({
              where: (table, { and, eq }) =>
                and(
                  eq(table.targetKey, GitHubTargetKey),
                  eq(table.integrationConnectionId, githubConnection.id),
                ),
              orderBy: (table, { desc }) => [desc(table.finalizedAt), desc(table.id)],
            });

            for (const event of events) {
              const comment = isGitHubWebhookTestObject(event.payload.comment)
                ? event.payload.comment
                : null;
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
            const run = await fixture.db.query.automationRuns.findFirst({
              where: (table, { eq }) => eq(table.sourceWebhookEventId, webhookEvent.id),
            });

            if (run === undefined) {
              return null;
            }

            if (run.status === AutomationRunStatuses.FAILED) {
              throw new Error(
                `Automation run failed: ${run.failureCode ?? "unknown"} ${run.failureMessage ?? ""}`,
              );
            }

            return run.status === AutomationRunStatuses.COMPLETED ? run : null;
          },
        });
        expect(automationRun.status).toBe(AutomationRunStatuses.COMPLETED);
        expect(automationRun.conversationId).not.toBeNull();

        const conversationId = automationRun.conversationId;
        if (conversationId === null) {
          throw new Error("Expected completed automation run to persist conversationId.");
        }

        const route = await waitForCondition({
          description: "active automation conversation route",
          timeoutMs: SandboxReadyTimeoutMs,
          evaluate: async () => {
            const persistedRoute = await fixture.db.query.automationConversationRoutes.findFirst({
              where: (table, { eq }) => eq(table.conversationId, conversationId),
            });

            if (persistedRoute === undefined || persistedRoute.providerConversationId === null) {
              return null;
            }

            return persistedRoute;
          },
        });
        const providerConversationId = route.providerConversationId;
        if (providerConversationId === null) {
          throw new Error(
            "Expected automation conversation route to persist providerConversationId.",
          );
        }

        const sandboxInstance = await waitForCondition({
          description: "running sandbox instance",
          timeoutMs: SandboxReadyTimeoutMs,
          evaluate: async () => {
            const response = await fixture.request(
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
        expect(sandboxInstance.id).toBe(route.sandboxInstanceId);

        const mintedConnectionToken = await requestJsonOrThrow({
          request: fixture.request,
          path: `/v1/sandbox/instances/${encodeURIComponent(route.sandboxInstanceId)}/connection-tokens`,
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

        sessionClient = new CodexSessionClient({
          connectionUrl: resolveGatewayWebSocketUrl({
            mintedUrl: mintedConnectionToken.url,
            gatewayBaseUrl: dataPlaneGatewayBaseUrl,
          }),
          runtime: createNodeCodexSessionRuntime(),
        });
        await sessionClient.connect();

        const codexRpcClient = new CodexJsonRpcClient(sessionClient);
        rpcClient = codexRpcClient;
        await codexRpcClient.initialize({
          clientInfo: {
            name: "mistle-system-tests",
            version: "0.1.0",
          },
        });

        await resumeCodexThread({
          rpcClient: codexRpcClient,
          threadId: providerConversationId,
        });

        const threadRead = await waitForCondition({
          description: "automation conversation thread containing webhook input",
          timeoutMs: ThreadReadTimeoutMs,
          evaluate: async () => {
            const result = await readCodexThread({
              rpcClient: codexRpcClient,
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

        expect(threadRead.threadId).toBe(providerConversationId);
      } finally {
        rpcClient?.dispose();
        sessionClient?.disconnect();

        if (issueNumber !== null) {
          await closeGitHubIssue({
            owner: repository.owner,
            repo: repository.repo,
            issueNumber,
            token: githubToken,
          });
        }
      }
    },
    TestTimeoutMs,
  );
});
