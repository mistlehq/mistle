/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
} from "@mistle/integrations-core";
import { reserveAvailablePort } from "@mistle/test-harness";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CompleteProviderAppSetupCallbackBadRequestResponseSchema } from "../src/integration-callbacks/provider-app-setup/schema.js";
import { CreateDraftFormConnectionBodySchema } from "../src/integration-connections/create-draft-form-connection/schema.js";
import { RefreshWebhookTriggerCapabilitiesBadRequestResponseSchema } from "../src/integration-connections/refresh-webhook-trigger-capabilities/schema.js";
import {
  CreatedFormIntegrationConnectionSchema,
  IntegrationConnectionSchema,
} from "../src/integration-connections/schemas.js";
import { StartedProviderAppSetupResponseSchema } from "../src/integration-connections/start-provider-app-setup/schema.js";
import {
  createFormConnection,
  seedIntegrationTarget,
  updateFormConnection,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const TestGitHubAppPrivateKeyPem = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCfRvx+zsgAVfj+",
  "MAxxnOv0nOREmxICbC33ade6TBzfiyki1f1XtrgowwynW6FGbLRVocYHure24e8J",
  "sBVHKj0pG9O9pvZEA3yokO7UY6y3sc8v5g+vB3drY3ZDyv3hv0kefp+yAUn64zLQ",
  "3o4ldL8ZO5FUF6LsJMkTvFeSjphTKUXJjuDdGrd+diTBh9D11Ity09R/zz5TGjL6",
  "1E2SMohPo6z/t+Q8k3sTixqGS91FCn1wNQQkqnsg/Hrjgv9egDZ39Boe9SC0pVpD",
  "fRN6tsL3fLOFvO4C8ug/HCZ4rRTfMclLwo/fSmWv+FzxGBpztFD1+L3WGYa6rnmH",
  "CTCrNynFAgMBAAECggEABi45PeDKGoHmNFOK0WgjMNNbY+fM4lqudZy+EgeCPFDD",
  "AyF2H/lMup+HphaJvXjvjijFotxQOjDDYjxwCu+nlBOKxcp3i7/t46r3auGbnLzc",
  "hbw3QhW3q4Czy2F9Cg2ZPwLEsXctgXvfp4K8qyqVVXDot1sRHPmNcu5aoJWCHCyc",
  "tB9CGHHD5onKSYFy7+zaRb1EDhLHUfiOiS1CQvXJh/U+whaC+eApg2z54HpNHx7z",
  "B+Z0IlxBcYoryWyRQ9KOu7toMQibI6ZY/gpxmnqrxahFaw4WIljgN9cPFVAA8LBb",
  "defEgUWe8A0ksiMX13X99wqrBJmV5e1lgnIzxp/amQKBgQDXbQbyQypN41seJayJ",
  "tprhj8DmE4Ud/aeVzX94Z0tcDVwJw9uJtcuZ9uL4N/tPWWv4CQn/cJK2ztzHKYbK",
  "k59ymtOColhf1Z5obvKhyODMaEZiEw4ebfAG/YHGGU6OxSiGq2maRVnEZuepTOVV",
  "oKGbLMkIP9LOJsahMNR+iF8bLQKBgQC9RrLpNCfLQzSlWmzyVO5uF0xuj5KbiiZi",
  "cu/WkDFFkXvi40giar+V7Eeh+q1xC7L5c5oMcsFkBYXaTiU958dEGU+cLpvYx1Jh",
  "AELXAVNGPqz4O/IYS1Ce1DxnoiS5lt9+i8nwn3BPpTdQxLFGCiUysPRgwgv7qVN4",
  "jYiaZYWH+QKBgD3HDFjpHfacHoM0tpf/f8bznJPeQSxqk2aIOefjZ18MjbpXKlwB",
  "gFO00z3vf+gvcqD8pptUQx6dj/6lT/xD/VO2RrWNrN4+umCkgHwYyS6VMKnrYP8k",
  "89JtXIvcsgSLUaXc/jm5bZa/E+wfGx1FJVMEstnkw6VOxWNwR1/J58w5AoGAL/Zd",
  "WcjUmKZEDe6XEuVAsfcHcDDDhtSAG4xiiC1rvuQ5z2mmmsoQGE6SbFJYZv/+70VC",
  "8QqXROA9Ze9Ncp1sGi6LxNjutwTzNA9b4J2+W1uAezq9gzh6inTfhadJxRmdMrT7",
  "jBTq4dPM65OcFFJ30JuUoXwqizACLdc3mWBGcQkCgYEAw8yBWkDOZ9h3PDsCHVr4",
  "zFSaWaHvK/rHhorGYKSFBzl4B2TLRlkuPoQ18L7AKzh4li2DugqOu468USWQ3JYb",
  "ZSXkSA+SLttOaN3WmreSNIWI++Yc2kjmC40TlUlBtAwG29+xVHMykhoageXmDmAU",
  "V6npTepI/eyvvYr21r4/XTY=",
  "-----END PRIVATE KEY-----",
].join("\n");

type StartedProviderAppSetupResponse = z.infer<typeof StartedProviderAppSetupResponseSchema>;
type StartedProviderAppSetupRedirect = Extract<
  StartedProviderAppSetupResponse,
  { kind: "redirect" }
>;

type GitHubApiRequest = {
  authorization?: string;
  method: string;
  pathname: string;
};

type StartedGitHubApiServer = {
  baseUrl: string;
  requests: GitHubApiRequest[];
  stop: () => Promise<void>;
};

type GitHubApiServerResponseInput =
  | {
      body: unknown;
      statusCode?: number;
    }
  | (() => {
      body: unknown;
      statusCode?: number;
    });

// This suite shares persisted GitHub App installation state across scenarios, so keep
// it sequential for deterministic stateless callback candidate assertions.
describe("GitHub App setup completion integration connections", () => {
  it("verifies the GitHub installation before marking the connection installed", async ({
    env,
  }) => {
    const targetKey = "github-cloud-installation-complete-success";
    const githubApi = await startGitHubApiServer({
      responseBody: {
        id: 12345,
        app_id: 123,
        app_slug: "mistle-github-app",
      },
    });

    try {
      await seedGitHubCloudTarget(env, {
        targetKey,
        apiBaseUrl: githubApi.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-new-github-app-installation-complete@example.com",
      });
      const connectionId = await createGitHubAppConnection(env, {
        targetKey,
        cookie: session.cookie,
        displayName: "GitHub Prod",
      });
      const state = await startGitHubAppInstallation(env, {
        cookie: session.cookie,
        connectionId,
      });

      // GitHub's setup URL callback includes `installation_id`, but their docs
      // call out that this value is spoofable. This request represents GitHub's
      // browser redirect; the runtime must verify the id with the GitHub API
      // before persisting it.
      // https://docs.github.com/en/enterprise-cloud@latest/apps/creating-github-apps/registering-a-github-app/about-the-setup-url
      const completeResponse = await env.controlPlaneApi.http.fetch(
        createGitHubAppInstallationCompletePath({
          state,
          installationId: "12345",
        }),
        {
          method: "GET",
          redirect: "manual",
        },
      );

      if (completeResponse.status !== 302) {
        throw new Error(
          `Expected setup completion status 302, got ${completeResponse.status.toString()}: ${await completeResponse.text()}`,
        );
      }
      expect(completeResponse.headers.get("location")).toContain(
        `/integrations/${targetKey}?connectionId=${connectionId}&connectionNotice=installed`,
      );
      expect(githubApi.requests).toEqual([
        {
          authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/u),
          method: "GET",
          pathname: "/app/installations/12345",
        },
      ]);

      const connection = await env.controlPlaneDb.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.id, connectionId)),
      });
      if (connection === undefined) {
        throw new Error("Expected persisted GitHub App connection.");
      }
      expect(connection.externalSubjectId).toBe("12345");
      expect(connection.config).toEqual({
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
        installation_id: "12345",
        setup_action: "install",
      });

      const redirectSession =
        await env.controlPlaneDb.query.integrationConnectionRedirectSessions.findFirst({
          where: (table, { eq }) => eq(table.state, state),
        });
      expect(redirectSession?.usedAt).not.toBeNull();
    } finally {
      await githubApi.stop();
    }
  });

  it("rejects an active GitHub App draft installation callback when GitHub omits redirect state", async ({
    env,
  }) => {
    const targetKey = "github-cloud-installation-complete-without-state";
    const githubApi = await startGitHubApiServer({
      responseBody: {
        id: 22345,
        app_id: 123,
        app_slug: "mistle-github-app",
      },
    });

    try {
      await seedGitHubCloudTarget(env, {
        targetKey,
        apiBaseUrl: githubApi.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-new-github-app-installation-complete-without-state@example.com",
      });
      const connectionId = await createGitHubAppDraftConnection(env, {
        targetKey,
        cookie: session.cookie,
        displayName: "GitHub Prod",
      });
      await configureGitHubAppConnection(env, {
        connectionId,
        cookie: session.cookie,
        displayName: "GitHub Prod",
      });
      const state = await startGitHubAppInstallation(env, {
        cookie: session.cookie,
        connectionId,
      });

      const completeResponse = await env.controlPlaneApi.http.fetch(
        createGitHubAppInstallationCompletePath({
          installationId: "22345",
          setupAction: "install",
        }),
        {
          method: "GET",
        },
      );

      expect(completeResponse.status).toBe(400);
      const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
        await completeResponse.json(),
      );
      expect(responseBody.code).toBe("INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT");
      expect(githubApi.requests).toEqual([]);

      const connection = await env.controlPlaneDb.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.id, connectionId)),
      });
      if (connection === undefined) {
        throw new Error("Expected persisted GitHub App connection.");
      }
      expect(connection.externalSubjectId).toBeNull();
      expect(connection.config).toEqual({
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
      });

      const redirectSession =
        await env.controlPlaneDb.query.integrationConnectionRedirectSessions.findFirst({
          where: (table, { eq }) => eq(table.state, state),
        });
      expect(redirectSession?.usedAt).toBeNull();
    } finally {
      await githubApi.stop();
    }
  });

  it("completes an installed GitHub App update callback when GitHub omits redirect state", async ({
    env,
  }) => {
    const targetKey = "github-cloud-installation-update-without-state";
    const githubApi = await startGitHubApiServer({
      responseBody: {
        id: 32345,
        app_id: 123,
        app_slug: "mistle-github-app",
      },
    });

    try {
      await seedGitHubCloudTarget(env, {
        targetKey,
        apiBaseUrl: githubApi.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-github-app-installation-update-without-state@example.com",
      });
      const connectionId = await createGitHubAppConnection(env, {
        targetKey,
        cookie: session.cookie,
        displayName: "GitHub Prod",
        installationId: "32345",
      });

      const completeResponse = await env.controlPlaneApi.http.fetch(
        createGitHubAppInstallationCompletePath({
          installationId: "32345",
          setupAction: "update",
        }),
        {
          method: "GET",
          redirect: "manual",
        },
      );

      expect(completeResponse.status).toBe(302);
      expect(completeResponse.headers.get("location")).toContain(
        `/integrations/${targetKey}?connectionId=${connectionId}&connectionNotice=installed`,
      );

      const connection = await env.controlPlaneDb.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.id, connectionId)),
      });
      if (connection === undefined) {
        throw new Error("Expected persisted GitHub App connection.");
      }
      expect(connection.externalSubjectId).toBe("32345");
      expect(connection.config).toEqual({
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
        installation_id: "32345",
        setup_action: "update",
      });
    } finally {
      await githubApi.stop();
    }
  });

  it("rejects a stateless GitHub App callback when multiple installed connections verify", async ({
    env,
  }) => {
    const targetKey = "github-cloud-installation-stateless-ambiguous";
    const githubApi = await startGitHubApiServer({
      responseBody: {
        id: 42345,
        app_id: 123,
        app_slug: "mistle-github-app",
      },
    });

    try {
      await seedGitHubCloudTarget(env, {
        targetKey,
        apiBaseUrl: githubApi.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-github-app-installation-stateless-ambiguous@example.com",
      });
      const firstConnectionId = await createGitHubAppConnection(env, {
        targetKey,
        cookie: session.cookie,
        displayName: "GitHub Prod 1",
        installationId: "42345",
      });
      const secondConnectionId = await createGitHubAppConnection(env, {
        targetKey,
        cookie: session.cookie,
        displayName: "GitHub Prod 2",
        installationId: "42345",
      });

      const completeResponse = await env.controlPlaneApi.http.fetch(
        createGitHubAppInstallationCompletePath({
          installationId: "42345",
          setupAction: "update",
        }),
        {
          method: "GET",
        },
      );

      expect(completeResponse.status).toBe(400);
      const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
        await completeResponse.json(),
      );
      expect(responseBody.code).toBe("INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT");

      const connections = await env.controlPlaneDb.query.integrationConnections.findMany({
        where: (table, { inArray }) => inArray(table.id, [firstConnectionId, secondConnectionId]),
        orderBy: (table, { asc }) => [asc(table.id)],
      });
      expect(connections.map((connection) => connection.externalSubjectId)).toEqual([null, null]);
      expect(connections.map((connection) => connection.config)).toEqual([
        {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-github-app",
          client_id: "Iv1.client123",
          installation_id: "42345",
        },
        {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-github-app",
          client_id: "Iv1.client123",
          installation_id: "42345",
        },
      ]);
    } finally {
      await githubApi.stop();
    }
  });

  it("refreshes GitHub webhook trigger capabilities from the verified installation", async ({
    env,
  }) => {
    const targetKey = "github-cloud-installation-trigger-capabilities-refresh";
    let expectedWebhookUrl = "";
    const githubApi = await startGitHubApiServer({
      // GitHub's installation response includes `events` and `permissions`;
      // those are the provider source of truth for webhook trigger capability refresh.
      // https://docs.github.com/en/rest/apps/apps#get-an-installation-for-the-authenticated-app
      responseBody: {
        id: 12345,
        app_id: 123,
        app_slug: "mistle-github-app",
        events: ["issues", "pull_request"],
        permissions: {
          issues: "read",
          metadata: "read",
          pull_requests: "write",
        },
      },
      // GitHub documents `GET /app/hook/config` as the app-authenticated source
      // for the configured GitHub App webhook delivery URL and content type.
      // https://docs.github.com/en/rest/apps/webhooks#get-a-webhook-configuration-for-an-app
      hookConfigResponse: () => ({
        body: {
          content_type: "json",
          insecure_ssl: "0",
          secret: "********",
          url: expectedWebhookUrl,
        },
      }),
    });

    try {
      await seedGitHubCloudTarget(env, {
        targetKey,
        apiBaseUrl: githubApi.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-github-app-trigger-capabilities-refresh@example.com",
      });
      const connectionId = await createGitHubAppConnection(env, {
        targetKey,
        cookie: session.cookie,
        displayName: "GitHub Prod",
      });
      const state = await startGitHubAppInstallation(env, {
        cookie: session.cookie,
        connectionId,
      });

      const completeResponse = await env.controlPlaneApi.http.fetch(
        createGitHubAppInstallationCompletePath({
          state,
          installationId: "12345",
        }),
        {
          method: "GET",
          redirect: "manual",
        },
      );
      expect(completeResponse.status).toBe(302);
      const sourceBeforeRefresh = await readGitHubWebhookSourceOrThrow(env, {
        connectionId,
        organizationId: session.organizationId,
      });
      expectedWebhookUrl = `${env.controlPlaneApi.hostBaseUrl}/p/integration/webhooks/${targetKey}/${sourceBeforeRefresh.endpointKey}`;

      const refreshResponse = await env.controlPlaneApi.http.fetch(
        `/v1/integration/connections/${encodeURIComponent(
          connectionId,
        )}/webhook-sources/trigger-capabilities/refresh`,
        {
          method: "POST",
          headers: {
            cookie: session.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      expect(refreshResponse.status).toBe(200);
      const webhookSource = await readGitHubWebhookSourceOrThrow(env, {
        connectionId,
        organizationId: session.organizationId,
      });
      expect(webhookSource.providerMetadata).toEqual({
        [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
          events: ["issues", "pull_request"],
          permissions: [
            { permission: "issues", access: "read" },
            { permission: "metadata", access: "read" },
            { permission: "pull_requests", access: "write" },
            { permission: "pull_requests", access: "read" },
          ],
        },
      });
      expect(githubApi.requests).toEqual([
        {
          authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/u),
          method: "GET",
          pathname: "/app/installations/12345",
        },
        {
          authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/u),
          method: "GET",
          pathname: "/app/installations/12345",
        },
        {
          authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/u),
          method: "GET",
          pathname: "/app/hook/config",
        },
      ]);
    } finally {
      await githubApi.stop();
    }
  });

  it("does not refresh GitHub webhook trigger capabilities when the app hook URL points elsewhere", async ({
    env,
  }) => {
    const targetKey = "github-cloud-installation-trigger-capabilities-wrong-hook-url";
    const githubApi = await startGitHubApiServer({
      responseBody: {
        id: 12345,
        app_id: 123,
        app_slug: "mistle-github-app",
        events: ["issues", "pull_request"],
        permissions: {
          issues: "read",
          metadata: "read",
          pull_requests: "write",
        },
      },
      hookConfigResponse: {
        body: {
          content_type: "json",
          insecure_ssl: "0",
          secret: "********",
          url: "https://other-control-plane.example.com/p/integration/webhooks/github-cloud/eps_other",
        },
      },
    });

    try {
      await seedGitHubCloudTarget(env, {
        targetKey,
        apiBaseUrl: githubApi.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-github-app-trigger-capabilities-refresh-wrong-url@example.com",
      });
      const connectionId = await createGitHubAppConnection(env, {
        targetKey,
        cookie: session.cookie,
        displayName: "GitHub Prod",
      });
      const state = await startGitHubAppInstallation(env, {
        cookie: session.cookie,
        connectionId,
      });

      const completeResponse = await env.controlPlaneApi.http.fetch(
        createGitHubAppInstallationCompletePath({
          state,
          installationId: "12345",
        }),
        {
          method: "GET",
          redirect: "manual",
        },
      );
      expect(completeResponse.status).toBe(302);

      const refreshResponse = await env.controlPlaneApi.http.fetch(
        `/v1/integration/connections/${encodeURIComponent(
          connectionId,
        )}/webhook-sources/trigger-capabilities/refresh`,
        {
          method: "POST",
          headers: {
            cookie: session.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );

      expect(refreshResponse.status).toBe(400);
      const responseBody = RefreshWebhookTriggerCapabilitiesBadRequestResponseSchema.parse(
        await refreshResponse.json(),
      );
      expect(responseBody.code).toBe("INVALID_WEBHOOK_SOURCE_INPUT");
      expect(responseBody.message).toContain("GitHub App webhook URL is");
      expect(responseBody.message).toContain(
        "https://other-control-plane.example.com/p/integration/webhooks/github-cloud/eps_other",
      );

      const webhookSource = await readGitHubWebhookSourceOrThrow(env, {
        connectionId,
        organizationId: session.organizationId,
      });
      expect(webhookSource.providerMetadata).toEqual({});
      expect(githubApi.requests).toEqual([
        {
          authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/u),
          method: "GET",
          pathname: "/app/installations/12345",
        },
        {
          authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/u),
          method: "GET",
          pathname: "/app/installations/12345",
        },
        {
          authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/u),
          method: "GET",
          pathname: "/app/hook/config",
        },
      ]);
    } finally {
      await githubApi.stop();
    }
  });

  it("does not install the connection when GitHub cannot verify the installation", async ({
    env,
  }) => {
    const targetKey = "github-cloud-installation-complete-unverified";
    const githubApi = await startGitHubApiServer({
      statusCode: 404,
      responseBody: {
        message: "Not Found",
      },
    });

    try {
      await seedGitHubCloudTarget(env, {
        targetKey,
        apiBaseUrl: githubApi.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-new-github-app-installation-complete-unverified@example.com",
      });
      const connectionId = await createGitHubAppConnection(env, {
        targetKey,
        cookie: session.cookie,
        displayName: "GitHub Prod",
      });
      const state = await startGitHubAppInstallation(env, {
        cookie: session.cookie,
        connectionId,
      });

      const completeResponse = await env.controlPlaneApi.http.fetch(
        createGitHubAppInstallationCompletePath({
          state,
          installationId: "12345",
        }),
        {
          method: "GET",
        },
      );

      expect(completeResponse.status).toBe(400);
      const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
        await completeResponse.json(),
      );
      expect(responseBody.code).toBe("INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT");

      const connection = await env.controlPlaneDb.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.id, connectionId)),
      });
      if (connection === undefined) {
        throw new Error("Expected persisted GitHub App connection.");
      }
      expect(connection.externalSubjectId).toBeNull();
      expect(connection.config).toEqual({
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
      });

      const redirectSession =
        await env.controlPlaneDb.query.integrationConnectionRedirectSessions.findFirst({
          where: (table, { eq }) => eq(table.state, state),
        });
      expect(redirectSession?.usedAt).toBeNull();
    } finally {
      await githubApi.stop();
    }
  });

  it("rejects a stateless GitHub App callback that does not match a verified connection", async ({
    env,
  }) => {
    const targetKey = "github-cloud-installation-complete-stateless-unknown";
    const githubApi = await startGitHubApiServer({
      responseBody: {
        id: 67890,
        app_id: 456,
        app_slug: "other-github-app",
      },
    });

    try {
      await seedGitHubCloudTarget(env, {
        targetKey,
        apiBaseUrl: githubApi.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-new-github-app-installation-complete-stateless-unknown@example.com",
      });
      const connectionId = await createGitHubAppDraftConnection(env, {
        targetKey,
        cookie: session.cookie,
        displayName: "GitHub Prod",
      });
      await configureGitHubAppConnection(env, {
        connectionId,
        cookie: session.cookie,
        displayName: "GitHub Prod",
      });
      const state = await startGitHubAppInstallation(env, {
        cookie: session.cookie,
        connectionId,
      });

      const completeResponse = await env.controlPlaneApi.http.fetch(
        createGitHubAppInstallationCompletePath({
          installationId: "67890",
        }),
        {
          method: "GET",
        },
      );

      expect(completeResponse.status).toBe(400);
      const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
        await completeResponse.json(),
      );
      expect(responseBody.code).toBe("INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT");

      const connection = await env.controlPlaneDb.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.id, connectionId)),
      });
      if (connection === undefined) {
        throw new Error("Expected persisted GitHub App connection.");
      }
      expect(connection.externalSubjectId).toBeNull();
      expect(connection.config).toEqual({
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
      });

      const redirectSession =
        await env.controlPlaneDb.query.integrationConnectionRedirectSessions.findFirst({
          where: (table, { eq }) => eq(table.state, state),
        });
      expect(redirectSession?.usedAt).toBeNull();
    } finally {
      await githubApi.stop();
    }
  });
});

async function seedGitHubCloudTarget(
  env: IntegrationTestEnvironment,
  input: { apiBaseUrl: string; targetKey: string },
): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: input.targetKey,
    familyId: "github",
    variantId: "github-cloud",
    config: {
      api_base_url: input.apiBaseUrl,
      web_base_url: "https://github.com",
    },
  });
}

async function createGitHubAppConnection(
  env: IntegrationTestEnvironment,
  input: {
    cookie: string;
    displayName: string;
    installationId?: string;
    targetKey: string;
  },
): Promise<string> {
  const response = await createFormConnection({
    env,
    targetKey: input.targetKey,
    cookie: input.cookie,
    body: {
      displayName: input.displayName,
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
        ...(input.installationId === undefined ? {} : { installation_id: input.installationId }),
      },
      secrets: {
        appPrivateKeyPem: TestGitHubAppPrivateKeyPem,
        clientSecret: "github-client-secret",
        webhookSecret: "github-webhook-secret",
      },
    },
  });

  expect(response.status).toBe(201);
  const createdConnection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
  return createdConnection.id;
}

async function createGitHubAppDraftConnection(
  env: IntegrationTestEnvironment,
  input: {
    cookie: string;
    displayName: string;
    targetKey: string;
  },
): Promise<string> {
  const response = await env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(
      input.targetKey,
    )}/github-app-installation/draft`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify(
        CreateDraftFormConnectionBodySchema.parse({
          displayName: input.displayName,
        }),
      ),
    },
  );

  expect(response.status).toBe(201);
  const createdConnection = IntegrationConnectionSchema.parse(await response.json());
  return createdConnection.id;
}

async function configureGitHubAppConnection(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    cookie: string;
    displayName: string;
  },
): Promise<void> {
  const response = await updateFormConnection({
    env,
    connectionId: input.connectionId,
    cookie: input.cookie,
    body: {
      displayName: input.displayName,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
      },
      secrets: {
        appPrivateKeyPem: TestGitHubAppPrivateKeyPem,
        clientSecret: "github-client-secret",
        webhookSecret: "github-webhook-secret",
      },
    },
  });

  expect(response.status).toBe(200);
}

async function readGitHubWebhookSourceOrThrow(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    organizationId: string;
  },
) {
  const webhookSource = await env.controlPlaneDb.query.integrationWebhookSources.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.integrationConnectionId, input.connectionId),
      ),
  });
  if (webhookSource === undefined) {
    throw new Error("Expected GitHub App webhook source.");
  }

  return webhookSource;
}

async function startGitHubAppInstallation(
  env: IntegrationTestEnvironment,
  input: {
    cookie: string;
    connectionId: string;
  },
): Promise<string> {
  const response = await env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(
      input.connectionId,
    )}/setup/github-app-installation/start`,
    {
      method: "POST",
      headers: {
        cookie: input.cookie,
      },
    },
  );

  expect(response.status).toBe(200);
  const responseBody = StartedProviderAppSetupResponseSchema.parse(await response.json());
  if (responseBody.kind !== "redirect") {
    throw new Error("Expected provider app setup start to return a redirect.");
  }

  return readStateFromStartedSetup(responseBody);
}

function readStateFromStartedSetup(response: StartedProviderAppSetupRedirect): string {
  const authorizationUrl = new URL(response.authorizationUrl);
  const state = authorizationUrl.searchParams.get("state");
  if (state === null || state.length === 0) {
    throw new Error("Expected redirect state in authorization URL.");
  }

  return state;
}

function createGitHubAppInstallationCompletePath(input: {
  installationId: string;
  setupAction?: string;
  state?: string;
}): string {
  const searchParams = new URLSearchParams();
  if (input.state !== undefined) {
    searchParams.set("state", input.state);
  }
  searchParams.set("installation_id", input.installationId);
  searchParams.set("setup_action", input.setupAction ?? "install");
  return `/p/integration/callbacks/setup/github-app-installation?${searchParams.toString()}`;
}

async function startGitHubApiServer(input: {
  hookConfigResponse?: GitHubApiServerResponseInput;
  responseBody: unknown;
  statusCode?: number;
}): Promise<StartedGitHubApiServer> {
  const host = "127.0.0.1";
  const port = await reserveAvailablePort({ host });
  const requests: GitHubApiRequest[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port.toString()}`);
    requests.push({
      method: request.method ?? "GET",
      pathname: requestUrl.pathname,
      ...(typeof request.headers.authorization === "string"
        ? { authorization: request.headers.authorization }
        : {}),
    });

    const responseInput =
      requestUrl.pathname === "/app/hook/config" && input.hookConfigResponse !== undefined
        ? resolveGitHubApiServerResponse(input.hookConfigResponse)
        : {
            body: input.responseBody,
            ...(input.statusCode === undefined ? {} : { statusCode: input.statusCode }),
          };

    response.statusCode = responseInput.statusCode ?? 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(responseInput.body));
  });

  await listen(server, { host, port });

  return {
    baseUrl: `http://${host}:${port.toString()}`,
    requests,
    stop: async () => close(server),
  };
}

function resolveGitHubApiServerResponse(input: GitHubApiServerResponseInput): {
  body: unknown;
  statusCode?: number;
} {
  return typeof input === "function" ? input() : input;
}

async function listen(server: Server, input: { host: string; port: number }): Promise<void> {
  server.listen(input.port, input.host);
  await once(server, "listening");
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}
