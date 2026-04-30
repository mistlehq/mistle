import { integrationTargets } from "@mistle/db/control-plane";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { describe, expect } from "vitest";

import { IntegrationTargetsPageSchema as DashboardIntegrationTargetsPageSchema } from "../../dashboard/src/features/integrations/integrations-service-shared.js";
import { ListIntegrationTargetsResponseSchema } from "../src/integration-targets/index.js";
import { it } from "./test-context.js";

describe("integration targets discovery integration", () => {
  it("returns keyset paginated enabled integration targets for an authenticated session", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-targets-list@example.com",
    });

    const baselineResponse = await fixture.request("/v1/integration/targets?limit=1", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(baselineResponse.status).toBe(200);
    const baselinePage = ListIntegrationTargetsResponseSchema.parse(await baselineResponse.json());

    await fixture.db
      .insert(integrationTargets)
      .values([
        {
          targetKey: "jira-default-it",
          familyId: "jira",
          variantId: "jira-default",
          enabled: true,
          config: {},
        },
        {
          targetKey: "github_cloud_it",
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            api_base_url: "https://api.github.com",
            web_base_url: "https://github.com",
          },
          displayNameOverride: "GitHub Cloud",
          descriptionOverride: "GitHub Cloud target",
        },
        {
          targetKey: "linear_cloud_it",
          familyId: "linear",
          variantId: "linear-cloud",
          enabled: true,
          config: {
            base_url: "https://api.linear.app",
          },
          displayNameOverride: "Linear Cloud",
          descriptionOverride: "Linear Cloud target",
        },
        {
          targetKey: "openai-default-it",
          familyId: "openai",
          variantId: "openai-default",
          enabled: true,
          config: {
            api_base_url: "https://api.openai.com",
          },
        },
        {
          targetKey: "zzz_disabled_target_it",
          familyId: "slack",
          variantId: "slack-webhooks",
          enabled: false,
          config: {
            base_url: "https://slack.com/api",
          },
        },
      ])
      .onConflictDoNothing();

    const firstPageResponse = await fixture.request("/v1/integration/targets?limit=2", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(firstPageResponse.status).toBe(200);
    const firstPage = ListIntegrationTargetsResponseSchema.parse(await firstPageResponse.json());

    expect(firstPage.totalResults).toBe(baselinePage.totalResults + 4);
    expect(firstPage.previousPage).toBeNull();
    expect(firstPage.nextPage).not.toBeNull();

    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPageResponse = await fixture.request(
      `/v1/integration/targets?limit=2&after=${encodeURIComponent(firstPage.nextPage.after)}`,
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = ListIntegrationTargetsResponseSchema.parse(await secondPageResponse.json());
    expect(secondPage.totalResults).toBe(baselinePage.totalResults + 4);
    expect(secondPage.previousPage).not.toBeNull();

    if (secondPage.previousPage === null) {
      throw new Error("Expected previous page cursor.");
    }

    const previousPageResponse = await fixture.request(
      `/v1/integration/targets?limit=2&before=${encodeURIComponent(secondPage.previousPage.before)}`,
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(previousPageResponse.status).toBe(200);
    const previousPage = ListIntegrationTargetsResponseSchema.parse(
      await previousPageResponse.json(),
    );
    expect(previousPage.totalResults).toBe(baselinePage.totalResults + 4);

    const allTargetsResponse = await fixture.request("/v1/integration/targets?limit=100", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(allTargetsResponse.status).toBe(200);
    const allTargets = ListIntegrationTargetsResponseSchema.parse(await allTargetsResponse.json());

    const insertedGitHubTarget = allTargets.items.find(
      (item) => item.targetKey === "github_cloud_it",
    );
    expect(insertedGitHubTarget).toMatchObject({
      targetKey: "github_cloud_it",
      familyId: "github",
      variantId: "github-cloud",
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

    const insertedLinearTarget = allTargets.items.find(
      (item) => item.targetKey === "linear_cloud_it",
    );
    expect(insertedLinearTarget).toMatchObject({
      targetKey: "linear_cloud_it",
      familyId: "linear",
      variantId: "linear-cloud",
      enabled: true,
      config: {
        base_url: "https://api.linear.app",
      },
      displayName: "Linear Cloud",
      description: "Linear Cloud target",
      displayNameOverride: "Linear Cloud",
      descriptionOverride: "Linear Cloud target",
      targetHealth: {
        configStatus: "valid",
      },
    });

    const insertedOpenAiTarget = allTargets.items.find(
      (item) => item.targetKey === "openai-default-it",
    );
    expect(insertedOpenAiTarget).toMatchObject({
      targetKey: "openai-default-it",
      familyId: "openai",
      variantId: "openai-default",
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
    expect(insertedOpenAiTarget?.config.api_base_url).toBe("https://api.openai.com");

    const insertedJiraTarget = allTargets.items.find(
      (item) => item.targetKey === "jira-default-it",
    );
    expect(insertedJiraTarget).toMatchObject({
      targetKey: "jira-default-it",
      familyId: "jira",
      variantId: "jira-default",
      enabled: true,
      displayName: "Jira",
      description: "Enable Jira issue access, automation, and optional Jira CLI in sandbox.",
      logoKey: "jira",
      connectionMethods: [
        {
          id: "jira-personal-api-token",
          label: "Personal API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Personal API token",
              placeholder: "Enter personal API token",
              inputType: "password",
              slotKey: "jira.jira-default.jira-personal-api-token.api-key",
            },
          ],
        },
        {
          id: "jira-service-account-api-token",
          label: "Service account API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Service account API token",
              placeholder: "Enter service account API token",
              inputType: "password",
              slotKey: "jira.jira-default.jira-service-account-api-token.api-key",
            },
          ],
        },
        {
          id: "jira-service-account-oauth-client-credentials",
          label: "Service account OAuth client credentials",
          kind: "form",
          secretFields: [
            {
              name: "clientSecret",
              label: "Client secret",
              placeholder: "Enter service account OAuth client secret",
              inputType: "password",
              slotKey:
                "jira.jira-default.jira-service-account-oauth-client-credentials.client-secret",
            },
          ],
        },
      ],
      targetHealth: {
        configStatus: "valid",
      },
    });

    expect(allTargets.items.some((item) => item.targetKey === "zzz_disabled_target_it")).toBe(
      false,
    );
  });

  it("returns 400 for invalid pagination cursor", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-targets-list-invalid-cursor@example.com",
    });

    const response = await fixture.request("/v1/integration/targets?after=invalid-cursor", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(400);

    const bodyText = await response.text();
    expect(bodyText).toContain('"code":"INVALID_PAGINATION_CURSOR"');
  });

  it("returns integration target payloads the dashboard parser can consume", async ({
    fixture,
  }) => {
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "github-dashboard-contract-it",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
        displayNameOverride: "GitHub Dashboard Contract",
        descriptionOverride: "GitHub contract target",
      })
      .onConflictDoNothing();

    const authenticatedSession = await fixture.authSession({
      email: "integration-targets-dashboard-contract@example.com",
    });

    const response = await fixture.request("/v1/integration/targets?limit=100", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);

    const page = DashboardIntegrationTargetsPageSchema.parse(await response.json());
    const githubTarget = page.items.find(
      (item) => item.targetKey === "github-dashboard-contract-it",
    );

    expect(githubTarget).toMatchObject({
      targetKey: "github-dashboard-contract-it",
      familyId: "github",
      variantId: "github-cloud",
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

  it("returns 400 for invalid list query payload", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-targets-list-validation@example.com",
    });

    const response = await fixture.request("/v1/integration/targets?after=abc&before=def", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("returns 401 when the request is unauthenticated", async ({ fixture }) => {
    const response = await fixture.request("/v1/integration/targets");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });

  it("returns OpenAI target metadata when target config is valid", async ({ fixture }) => {
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
        },
      })
      .onConflictDoUpdate({
        target: integrationTargets.targetKey,
        set: {
          familyId: "openai",
          variantId: "openai-default",
          enabled: true,
          config: {
            api_base_url: "https://api.openai.com",
          },
        },
      });

    const authenticatedSession = await fixture.authSession({
      email: "integration-targets-list-openai-projection@example.com",
    });

    const response = await fixture.request("/v1/integration/targets?limit=100", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);
    const page = ListIntegrationTargetsResponseSchema.parse(await response.json());
    const openAiTarget = page.items.find((item) => item.targetKey === "openai-default");
    expect(openAiTarget).toBeDefined();
    expect(openAiTarget?.targetHealth.configStatus).toBe("valid");
    expect(openAiTarget?.connectionMethods).toEqual([
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
        },
      },
    ]);
    expect("resolvedBindingEditorUi" in (openAiTarget ?? {})).toBe(false);
  }, 60_000);
});
