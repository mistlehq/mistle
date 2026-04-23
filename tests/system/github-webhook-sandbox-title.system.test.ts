/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import { AutomationRunStatuses } from "@mistle/db/control-plane";
import { systemSleeper } from "@mistle/time";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { z } from "zod";

import {
  startCloudflaredTunnel,
  type StartedCloudflaredTunnel,
} from "./helpers/cloudflared-tunnel.js";
import { resolveGitHubAppInstallationId } from "./helpers/github-app-installation.js";
import { it, readSystemTestContext } from "./system-test-context.js";

const OpenAiTargetKey = "openai-default";
const GitHubTargetKey = "github-cloud";
const OpenAiConnectionMethodId = "api-key";
const TestTimeoutMs = 10 * 60_000;
const TunnelStartupTimeoutMs = 60_000;
const PollIntervalMs = 2_000;
const SandboxReadyTimeoutMs = 3 * 60_000;
const WebhookDeliveryTimeoutMs = 3 * 60_000;
const AutomationRunTimeoutMs = 3 * 60_000;
const ResourceSyncTimeoutMs = 2 * 60_000;

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
  title: z.string().min(1).nullable(),
  status: z.enum(["pending", "starting", "running", "stopped", "failed"]),
  connectable: z.boolean(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  runtimeContext: z.unknown().nullable().optional(),
  automationConversation: z.unknown().nullable().optional(),
});

const GitHubIssueResponseSchema = z.looseObject({
  number: z.number().int().positive(),
});

const GitHubIssueCommentResponseSchema = z.looseObject({
  id: z.number().int().positive(),
  body: z.string().min(1),
});

type GitHubRepository = {
  owner: string;
  repo: string;
};

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

function parseGitHubRepository(input: string): GitHubRepository {
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

function createGitHubAppInstallationCompletePath(input: { query: Record<string, string> }): string {
  const searchParams = new URLSearchParams(input.query);
  return `/p/integration/callbacks/github-app-installation?${searchParams.toString()}`;
}

function resolveControlPlaneApiLocalPort(controlPlaneApiBaseUrl: string): number {
  const baseUrl = new URL(controlPlaneApiBaseUrl);
  const parsedPort = Number.parseInt(baseUrl.port, 10);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error("Control plane API base URL must include a positive numeric port.");
  }

  return parsedPort;
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

async function createGitHubConnection(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  cookie: string;
  githubAppId: string;
  githubAppSlug: string;
  githubAppClientId: string;
  githubAppClientSecret: string;
  githubAppPrivateKeyPem: string;
  githubWebhookSecret: string;
  displayName: string;
}): Promise<string> {
  const connection = await requestJsonOrThrow({
    request: input.request,
    path: `/v1/integration/connections/${encodeURIComponent(GitHubTargetKey)}/form`,
    expectedStatus: 201,
    description: "GitHub connection creation",
    schema: IntegrationConnectionResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify({
        displayName: input.displayName,
        methodId: "github-app-installation",
        config: {
          connection_method: "github-app-installation",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const describeIf = hasRequiredEnv() ? describe : describe.skip;

describeIf("system GitHub webhook sandbox title seeding", () => {
  let tunnel: StartedCloudflaredTunnel | null = null;

  beforeAll(async () => {
    const systemTestContext = await readSystemTestContext();
    tunnel = await startCloudflaredTunnel({
      tunnelId: requireEnv("CLOUDFLARE_TUNNEL_ID"),
      tunnelCredentialsJson: requireEnv("CLOUDFLARE_TUNNEL_CREDENTIALS_JSON"),
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
    "seeds a non-empty sandbox title after a real GitHub webhook automation delivery",
    async ({ fixture }) => {
      const repository = parseGitHubRepository(requireEnv("MISTLE_TEST_GITHUB_TEST_REPOSITORY"));
      const githubToken = requireEnv("MISTLE_TEST_GITHUB_TOKEN");
      const githubAppId = requireEnv("MISTLE_TEST_GITHUB_APP_ID");
      const githubAppSlug = requireEnv("MISTLE_TEST_GITHUB_APP_SLUG");
      const githubAppClientId = requireEnv("MISTLE_TEST_GITHUB_APP_CLIENT_ID");
      const githubAppClientSecret = requireEnv("MISTLE_TEST_GITHUB_APP_CLIENT_SECRET");
      const githubAppPrivateKeyPem = requireEnv("MISTLE_TEST_GITHUB_APP_PRIVATE_KEY_PEM");
      const githubWebhookSecret = requireEnv("MISTLE_TEST_GITHUB_WEBHOOK_SECRET");
      const githubInstallationId = await resolveGitHubAppInstallationId({
        owner: repository.owner,
        repo: repository.repo,
        targetKey: GitHubTargetKey,
      });
      const openAiApiKey = requireEnv("MISTLE_TEST_OPENAI_API_KEY");

      const payloadMarker = `mistle-system-title-${randomUUID()}`;
      const session = await fixture.authSession();

      const openAiConnection = await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/integration/connections/${encodeURIComponent(OpenAiTargetKey)}/form`,
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
            displayName: `GitHub Title Test OpenAI ${randomUUID()}`,
            methodId: OpenAiConnectionMethodId,
            config: {
              connection_method: OpenAiConnectionMethodId,
            },
            secrets: {
              apiKey: openAiApiKey,
            },
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
            displayName: `GitHub Title System Test ${randomUUID()}`,
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
          }),
        },
      });

      const githubConnectionId = await createGitHubConnection({
        request: fixture.request,
        cookie: session.cookie,
        githubAppId,
        githubAppSlug,
        githubAppClientId,
        githubAppClientSecret,
        githubAppPrivateKeyPem,
        githubWebhookSecret,
        displayName: `GitHub Title Test GitHub ${randomUUID()}`,
      });

      const githubOauthStart = await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/integration/connections/${encodeURIComponent(githubConnectionId)}/github-app-installation/start`,
        expectedStatus: 200,
        description: "GitHub App installation start",
        schema: StartRedirectConnectionResponseSchema,
        init: {
          method: "POST",
          headers: {
            cookie: session.cookie,
          },
        },
      });

      const githubOauthState = new URL(githubOauthStart.authorizationUrl).searchParams.get("state");
      if (githubOauthState === null || githubOauthState.length === 0) {
        throw new Error(
          "Expected GitHub App installation start response to include a non-empty state.",
        );
      }

      const githubAppInstallationCompleteResponse = await fixture.request(
        createGitHubAppInstallationCompletePath({
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
      if (githubAppInstallationCompleteResponse.status !== 302) {
        const errorBody = await githubAppInstallationCompleteResponse.text().catch(() => "");
        throw new Error(
          `GitHub App installation completion expected status 302, got ${String(githubAppInstallationCompleteResponse.status)}. Response body: ${errorBody}`,
        );
      }

      const githubConnection = await waitForCondition({
        description: "persisted GitHub connection installation to be completed",
        timeoutMs: AutomationRunTimeoutMs,
        evaluate: async () => {
          return (
            (await fixture.db.query.integrationConnections.findFirst({
              where: (table, { and, eq }) =>
                and(
                  eq(table.id, githubConnectionId),
                  eq(table.organizationId, session.organizationId),
                  eq(table.externalSubjectId, githubInstallationId),
                ),
            })) ?? null
          );
        },
      });

      await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/integration/connections/${encodeURIComponent(githubConnection.id)}/resources/repository/refresh`,
        expectedStatus: 202,
        description: "GitHub repository resource refresh",
        schema: RefreshIntegrationConnectionResourcesResponseSchema,
        init: {
          method: "POST",
          headers: {
            cookie: session.cookie,
          },
        },
      });

      await waitForCondition({
        description: "GitHub repository resource sync to reach ready",
        timeoutMs: ResourceSyncTimeoutMs,
        evaluate: async () => {
          const resourceState =
            await fixture.db.query.integrationConnectionResourceStates.findFirst({
              where: (table, { and, eq }) =>
                and(eq(table.connectionId, githubConnection.id), eq(table.kind, "repository")),
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

          const resource = await fixture.db.query.integrationConnectionResources.findFirst({
            where: (table, { and, eq }) =>
              and(
                eq(table.connectionId, githubConnection.id),
                eq(table.kind, "repository"),
                eq(table.handle, `${repository.owner}/${repository.repo}`),
              ),
          });

          return resource === undefined ? null : resource;
        },
      });

      const githubWebhookSources = await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/integration/connections/${encodeURIComponent(githubConnection.id)}/webhook-sources`,
        expectedStatus: 200,
        description: "GitHub webhook source listing",
        schema: z.array(IntegrationWebhookSourceResponseSchema),
        init: {
          method: "GET",
          headers: {
            cookie: session.cookie,
          },
        },
      });

      const githubWebhookSource = githubWebhookSources.find(
        (source) =>
          source.targetKey === GitHubTargetKey &&
          source.integrationConnectionId === githubConnection.id,
      );
      if (githubWebhookSource === undefined) {
        throw new Error(
          `Expected an implicit connection-owned GitHub webhook source for connection '${githubConnection.id}'. Sources: ${JSON.stringify(githubWebhookSources)}`,
        );
      }

      await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/sandbox/profiles/${encodeURIComponent(sandboxProfile.id)}/versions/1/integration-bindings`,
        expectedStatus: 200,
        description: "sandbox profile integration binding update after GitHub connection",
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
                connectionId: githubConnection.id,
                kind: "git",
                config: {
                  repositories: [`${repository.owner}/${repository.repo}`],
                  tools: ["github-cli"],
                },
              },
            ],
          }),
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
            name: `GitHub Title Automation ${randomUUID()}`,
            enabled: true,
            integrationWebhookSourceId: githubWebhookSource.id,
            eventTypes: ["github.issue_comment.created"],
            payloadFilter: {
              "github.issue_comment.created": {
                op: "contains",
                path: ["comment", "body"],
                value: payloadMarker,
              },
            },
            inputTemplate: "GitHub issue comment webhook: {{payload.comment.body}}",
            conversationKeyTemplate: "github-issue-title-{{payload.issue.number}}",
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

      try {
        const issue = await githubRequestJson({
          method: "POST",
          path: `/repos/${repository.owner}/${repository.repo}/issues`,
          token: githubToken,
          description: "GitHub issue creation",
          schema: GitHubIssueResponseSchema,
          body: {
            title: `Webhook title system test ${payloadMarker}`,
            body: `Webhook title system test issue ${payloadMarker}`,
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
            const run = await fixture.db.query.automationRuns.findFirst({
              where: (table, { eq }) => eq(table.sourceWebhookEventId, webhookEvent.id),
            });

            if (run === undefined) {
              return null;
            }

            if (run.status === AutomationRunStatuses.FAILED) {
              throw new Error(
                `Automation run failed: ${run.failureCode ?? "unknown"} ${run.failureMessage ?? ""}.`,
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
            return (
              (await fixture.db.query.automationConversationRoutes.findFirst({
                where: (table, { eq }) => eq(table.conversationId, conversationId),
              })) ?? null
            );
          },
        });

        const sandboxInstance = await waitForCondition({
          description: "running sandbox instance with a seeded title",
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

            if (status.status !== "running" || status.title === null) {
              return null;
            }

            return status;
          },
        });

        expect(sandboxInstance.id).toBe(route.sandboxInstanceId);
        expect(sandboxInstance.title).not.toBeNull();
        expect(sandboxInstance.title?.trim().length).toBeGreaterThan(0);
      } finally {
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
