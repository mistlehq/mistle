/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { IntegrationTargetsPageSchema as DashboardIntegrationTargetsPageSchema } from "../../dashboard/src/features/integrations/integrations-service-shared.js";
import { ListIntegrationTargetsResponseSchema } from "../src/integration-targets/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration targets discovery integration", () => {
  it("returns keyset paginated enabled integration targets for an authenticated session", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-targets-list@example.com",
    });

    await seedTarget(env, {
      targetKey: "github_cloud_integration_new_targets_list",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      displayNameOverride: "GitHub Cloud",
      descriptionOverride: "GitHub Cloud target",
    });
    await seedTarget(env, {
      targetKey: "linear_cloud_integration_new_targets_list",
      familyId: "linear",
      variantId: "linear-default",
      enabled: true,
      config: {},
      displayNameOverride: "Linear Cloud",
      descriptionOverride: "Linear Cloud target",
    });
    await seedTarget(env, {
      targetKey: "openai_integration_new_targets_list",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com",
      },
    });
    await seedTarget(env, {
      targetKey: "zzz_disabled_integration_new_targets_list",
      familyId: "slack",
      variantId: "slack-webhooks",
      enabled: false,
      config: {
        base_url: "https://slack.com/api",
      },
    });

    const firstPage = await listTargets({
      cookie: session.cookie,
      env,
      query: "limit=2",
    });

    expect(firstPage.previousPage).toBeNull();
    expect(firstPage.nextPage).not.toBeNull();
    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPage = await listTargets({
      cookie: session.cookie,
      env,
      query: `limit=2&after=${encodeURIComponent(firstPage.nextPage.after)}`,
    });
    expect(secondPage.previousPage).not.toBeNull();
    if (secondPage.previousPage === null) {
      throw new Error("Expected previous page cursor.");
    }

    const previousPage = await listTargets({
      cookie: session.cookie,
      env,
      query: `limit=2&before=${encodeURIComponent(secondPage.previousPage.before)}`,
    });
    expect(previousPage.items.map((target) => target.targetKey)).toEqual(
      firstPage.items.map((target) => target.targetKey),
    );

    const allTargets = await listTargets({
      cookie: session.cookie,
      env,
      query: "limit=100",
    });

    expect(
      allTargets.items.some(
        (item) => item.targetKey === "zzz_disabled_integration_new_targets_list",
      ),
    ).toBe(false);
    expect(findTarget(allTargets, "github_cloud_integration_new_targets_list")).toMatchObject({
      targetKey: "github_cloud_integration_new_targets_list",
      familyId: "github",
      variantId: "github-cloud",
      kind: "git",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      displayName: "GitHub Cloud",
      description: "GitHub Cloud target",
      logoKey: "github",
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              placeholder: "Enter API key",
              inputType: "password",
              slotKey: "github.github-cloud.api-key.api-key",
            },
          ],
        },
        {
          id: "github-app-installation",
          label: "GitHub App installation",
          kind: "form",
          secretFields: [
            {
              name: "appPrivateKeyPem",
              label: "App private key PEM",
              placeholder: "-----BEGIN PRIVATE KEY-----",
              inputType: "textarea",
              slotKey: "github.github-cloud.github-app-installation.app-private-key-pem",
            },
            {
              name: "clientSecret",
              label: "Client secret",
              placeholder: "Enter client secret",
              inputType: "password",
              slotKey: "github.github-cloud.github-app-installation.client-secret",
            },
            {
              name: "webhookSecret",
              label: "Webhook secret",
              placeholder: "Enter webhook secret",
              inputType: "password",
              slotKey: "github.github-cloud.github-app-installation.webhook-secret",
            },
          ],
        },
      ],
      webhookSource: {
        lifecycle: "implicit",
        requiresSourceSelection: true,
      },
      supportedWebhookEvents: expect.arrayContaining([
        expect.objectContaining({
          eventType: "github.issue_comment.created",
          providerEventType: "issue_comment",
          displayName: "Issue comment created",
          category: "Issues",
        }),
        expect.objectContaining({
          eventType: "github.pull_request.opened",
          providerEventType: "pull_request",
          displayName: "Pull request opened",
          category: "Pull requests",
        }),
        expect.objectContaining({
          eventType: "github.pull_request_review_comment.created",
          providerEventType: "pull_request_review_comment",
          displayName: "Pull request review comment created",
          category: "Pull requests",
        }),
      ]),
      displayNameOverride: "GitHub Cloud",
      descriptionOverride: "GitHub Cloud target",
      targetHealth: {
        configStatus: "valid",
      },
    });
    expect(findTarget(allTargets, "linear_cloud_integration_new_targets_list")).toMatchObject({
      targetKey: "linear_cloud_integration_new_targets_list",
      familyId: "linear",
      variantId: "linear-default",
      kind: "connector",
      enabled: true,
      config: {},
      displayName: "Linear Cloud",
      description: "Linear Cloud target",
      targetHealth: {
        configStatus: "valid",
      },
    });
    expect(findTarget(allTargets, "openai_integration_new_targets_list")).toMatchObject({
      targetKey: "openai_integration_new_targets_list",
      familyId: "openai",
      variantId: "openai-default",
      kind: "agent",
      enabled: true,
      displayName: "OpenAI",
      description:
        "Enable OpenAI model access with API key or ChatGPT subscription authentication.",
      logoKey: "openai",
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              placeholder: "Enter API key",
              inputType: "password",
              slotKey: "openai.openai-default.api-key.api-key",
            },
          ],
        },
        {
          id: "chatgpt-device-code",
          label: "ChatGPT subscription",
          kind: "device-authorization",
          ui: {
            create: {
              submitLabel: "Connect",
            },
            pending: {
              title: "Approve via ChatGPT",
              description: "Open the link below and enter the code to approve access.",
            },
          },
        },
      ],
      targetHealth: {
        configStatus: "valid",
      },
    });
  });

  it("returns 400 for invalid pagination cursor", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-targets-list-invalid-cursor@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/targets?after=invalid-cursor",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('"code":"INVALID_PAGINATION_CURSOR"');
  });

  it("returns integration target payloads the dashboard parser can consume", async ({ env }) => {
    await seedTarget(env, {
      targetKey: "github_dashboard_contract_integration_new",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      displayNameOverride: "GitHub Dashboard Contract",
      descriptionOverride: "GitHub contract target",
    });

    const session = await env.auth.createSession({
      email: "integration-new-targets-dashboard-contract@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/integration/targets?limit=100", {
      headers: {
        cookie: session.cookie,
      },
    });
    expect(response.status).toBe(200);

    const page = DashboardIntegrationTargetsPageSchema.parse(await response.json());
    expect(findTarget(page, "github_dashboard_contract_integration_new")).toMatchObject({
      targetKey: "github_dashboard_contract_integration_new",
      familyId: "github",
      variantId: "github-cloud",
      kind: "git",
      enabled: true,
      displayName: "GitHub Dashboard Contract",
      description: "GitHub contract target",
      connectionMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              slotKey: "github.github-cloud.api-key.api-key",
            },
          ],
        },
        {
          id: "github-app-installation",
          label: "GitHub App installation",
          kind: "form",
          secretFields: [
            {
              name: "appPrivateKeyPem",
              label: "App private key PEM",
              inputType: "textarea",
              slotKey: "github.github-cloud.github-app-installation.app-private-key-pem",
            },
            {
              name: "clientSecret",
              label: "Client secret",
              inputType: "password",
              slotKey: "github.github-cloud.github-app-installation.client-secret",
            },
            {
              name: "webhookSecret",
              label: "Webhook secret",
              inputType: "password",
              slotKey: "github.github-cloud.github-app-installation.webhook-secret",
            },
          ],
        },
      ],
      targetHealth: {
        configStatus: "valid",
      },
    });
  });

  it("returns 400 for invalid list query payload", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-targets-list-validation@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/targets?after=abc&before=def",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("returns 401 when the request is unauthenticated", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/v1/integration/targets");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });

  it("returns OpenAI target metadata when target config is valid", async ({ env }) => {
    await seedTarget(env, {
      targetKey: "openai_projection_integration_new",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com",
      },
    });

    const session = await env.auth.createSession({
      email: "integration-new-targets-list-openai-projection@example.com",
    });

    const page = await listTargets({
      cookie: session.cookie,
      env,
      query: "limit=100",
    });
    const openAiTarget = findTarget(page, "openai_projection_integration_new");

    expect(openAiTarget.kind).toBe("agent");
    expect(openAiTarget.targetHealth.configStatus).toBe("valid");
    expect(openAiTarget.connectionMethods).toEqual([
      {
        id: "api-key",
        label: "API key",
        kind: "form",
        secretFields: [
          {
            name: "apiKey",
            label: "API key",
            optional: false,
            placeholder: "Enter API key",
            inputType: "password",
            slotKey: "openai.openai-default.api-key.api-key",
          },
        ],
      },
      {
        id: "chatgpt-device-code",
        label: "ChatGPT subscription",
        kind: "device-authorization",
        ui: {
          create: {
            submitLabel: "Connect",
          },
          pending: {
            title: "Approve via ChatGPT",
            description: "Open the link below and enter the code to approve access.",
          },
          reauthorize: {
            actionLabel: "Re-authorize",
            pendingLabel: "Starting...",
          },
        },
      },
    ]);
    expect("resolvedBindingEditorUi" in openAiTarget).toBe(false);
  });
});

type IntegrationTargetsPage = ReturnType<typeof ListIntegrationTargetsResponseSchema.parse>;

async function seedTarget(
  env: IntegrationTestEnvironment,
  input: {
    targetKey: string;
    familyId: string;
    variantId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    displayNameOverride?: string;
    descriptionOverride?: string;
  },
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: input.familyId,
      variantId: input.variantId,
      enabled: input.enabled,
      config: input.config,
      displayNameOverride: input.displayNameOverride,
      descriptionOverride: input.descriptionOverride,
    })
    .onConflictDoUpdate({
      target: env.controlPlaneTables.integrationTargets.targetKey,
      set: {
        familyId: input.familyId,
        variantId: input.variantId,
        enabled: input.enabled,
        config: input.config,
        displayNameOverride: input.displayNameOverride,
        descriptionOverride: input.descriptionOverride,
      },
    });
}

async function listTargets(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  query: string;
}): Promise<IntegrationTargetsPage> {
  const response = await input.env.controlPlaneApi.http.fetch(
    `/v1/integration/targets?${input.query}`,
    {
      headers: {
        cookie: input.cookie,
      },
    },
  );
  expect(response.status).toBe(200);

  return ListIntegrationTargetsResponseSchema.parse(await response.json());
}

function findTarget<TPage extends { items: Array<{ targetKey: string }> }>(
  page: TPage,
  targetKey: string,
): TPage["items"][number] {
  const target = page.items.find((item) => item.targetKey === targetKey);
  if (target === undefined) {
    throw new Error(`Expected target '${targetKey}' to be listed.`);
  }

  return target;
}
