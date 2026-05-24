/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { reserveAvailablePort } from "@mistle/test-harness";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CreatedFormIntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import {
  StartedProviderAppSetupResponseSchema,
  StartProviderAppSetupBadRequestResponseSchema,
  StartProviderAppSetupNotFoundResponseSchema,
} from "../src/integration-connections/start-provider-app-setup/schema.js";
import { createFormConnection, seedIntegrationTarget } from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const GitHubCloudStartTargetKey = "github-cloud-start-setup";
const GitHubEnterpriseStartTargetKey = "github-enterprise-server-start-setup";
const GitHubCloudUnsupportedTargetKey = "github-cloud-start-unsupported";

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

describe.concurrent("GitHub App setup start integration connections", () => {
  it("creates a GitHub App installation authorization URL and persists redirect state", async ({
    env,
  }) => {
    const githubApi = await startGitHubApiServer();
    try {
      await seedGitHubCloudTarget(env, {
        targetKey: GitHubCloudStartTargetKey,
        apiBaseUrl: githubApi.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-new-github-app-installation-start@example.com",
      });
      const connectionId = await createGitHubAppConnection(env, {
        targetKey: GitHubCloudStartTargetKey,
        cookie: session.cookie,
        displayName: "GitHub Prod",
        appId: "123",
        appSlug: "mistle-github-app",
        clientId: "Iv1.client123",
        includeClientSecret: true,
      });

      const { authorizationUrl, state } = await startGitHubAppInstallation(env, {
        cookie: session.cookie,
        connectionId,
      });

      expect(authorizationUrl.origin).toBe("https://github.com");
      expect(authorizationUrl.pathname).toBe("/apps/mistle-github-app/installations/select_target");
      expect(githubApi.requests).toEqual([
        {
          authorization: expect.stringMatching(/^[Bb]earer [^.]+\.[^.]+\.[^.]+$/u),
          method: "GET",
          pathname: "/app/installations",
        },
      ]);
      await expectRedirectSession(env, {
        organizationId: session.organizationId,
        targetKey: GitHubCloudStartTargetKey,
        state,
      });
    } finally {
      await githubApi.stop();
    }
  });

  it("starts GitHub Enterprise Server App installation through the generic setup route", async ({
    env,
  }) => {
    const githubApi = await startGitHubApiServer();
    try {
      await seedGitHubEnterpriseServerTarget(env, {
        targetKey: GitHubEnterpriseStartTargetKey,
        apiBaseUrl: `${githubApi.baseUrl}/api/v3`,
      });
      const session = await env.auth.createSession({
        email: "integration-new-github-enterprise-app-installation-start@example.com",
      });
      const connectionId = await createGitHubAppConnection(env, {
        targetKey: GitHubEnterpriseStartTargetKey,
        cookie: session.cookie,
        displayName: "GitHub Enterprise",
        appId: "456",
        appSlug: "mistle-github-enterprise-app",
        clientId: "Iv1.enterpriseclient123",
        includeClientSecret: false,
      });

      const { authorizationUrl, state } = await startGitHubAppInstallation(env, {
        cookie: session.cookie,
        connectionId,
      });

      expect(authorizationUrl.origin).toBe("https://github.enterprise.example.com");
      expect(authorizationUrl.pathname).toBe(
        "/github-apps/mistle-github-enterprise-app/installations/select_target",
      );
      expect(githubApi.requests).toEqual([
        {
          authorization: expect.stringMatching(/^[Bb]earer [^.]+\.[^.]+\.[^.]+$/u),
          method: "GET",
          pathname: "/api/v3/app/installations",
        },
      ]);
      await expectRedirectSession(env, {
        organizationId: session.organizationId,
        targetKey: GitHubEnterpriseStartTargetKey,
        state,
      });
    } finally {
      await githubApi.stop();
    }
  });

  it("returns 400 when the connection does not use GitHub App installation auth", async ({
    env,
  }) => {
    await seedGitHubCloudTarget(env, {
      targetKey: GitHubCloudUnsupportedTargetKey,
      apiBaseUrl: "https://api.github.com",
    });
    const session = await env.auth.createSession({
      email: "integration-new-github-app-installation-unsupported-connection@example.com",
    });
    const connectionId = await createGitHubApiKeyConnection(env, {
      targetKey: GitHubCloudUnsupportedTargetKey,
      cookie: session.cookie,
      displayName: "GitHub API key",
    });

    const response = await env.controlPlaneApi.http.fetch(
      `/v1/integration/connections/${encodeURIComponent(
        connectionId,
      )}/setup/github-app-installation/start`,
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    const responseBody = StartProviderAppSetupBadRequestResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("PROVIDER_APP_SETUP_CONNECTION_METHOD_NOT_SUPPORTED");
  });

  it("returns 404 when the GitHub App installation start connection does not exist", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-github-app-installation-missing-connection@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/connections/icn_missing/setup/github-app-installation/start",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = StartProviderAppSetupNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("CONNECTION_NOT_FOUND");
  });
});

async function seedGitHubCloudTarget(
  env: IntegrationTestEnvironment,
  input: { targetKey: string; apiBaseUrl: string },
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

async function seedGitHubEnterpriseServerTarget(
  env: IntegrationTestEnvironment,
  input: { targetKey: string; apiBaseUrl: string },
): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: input.targetKey,
    familyId: "github",
    variantId: "github-enterprise-server",
    config: {
      api_base_url: input.apiBaseUrl,
      web_base_url: "https://github.enterprise.example.com",
    },
  });
}

async function createGitHubAppConnection(
  env: IntegrationTestEnvironment,
  input: {
    targetKey: string;
    cookie: string;
    displayName: string;
    appId: string;
    appSlug: string;
    clientId: string;
    includeClientSecret: boolean;
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
        app_id: input.appId,
        app_slug: input.appSlug,
        client_id: input.clientId,
      },
      secrets: {
        appPrivateKeyPem: TestGitHubAppPrivateKeyPem,
        ...(input.includeClientSecret ? { clientSecret: "github-client-secret" } : {}),
        webhookSecret: "github-webhook-secret",
      },
    },
  });

  expect(response.status).toBe(201);
  const createdConnection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
  return createdConnection.id;
}

async function createGitHubApiKeyConnection(
  env: IntegrationTestEnvironment,
  input: {
    targetKey: string;
    cookie: string;
    displayName: string;
  },
): Promise<string> {
  const response = await createFormConnection({
    env,
    targetKey: input.targetKey,
    cookie: input.cookie,
    body: {
      displayName: input.displayName,
      methodId: IntegrationConnectionMethodIds.API_KEY,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      secrets: {
        apiKey: "github-api-key",
      },
    },
  });

  expect(response.status).toBe(201);
  const createdConnection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
  return createdConnection.id;
}

async function startGitHubAppInstallation(
  env: IntegrationTestEnvironment,
  input: {
    cookie: string;
    connectionId: string;
  },
): Promise<{ authorizationUrl: URL; state: string }> {
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
  const responseBody = await parseStartedProviderAppSetupRedirect(response);
  const authorizationUrl = new URL(responseBody.authorizationUrl);
  const state = authorizationUrl.searchParams.get("state");
  if (state === null || state.length === 0) {
    throw new Error("Expected redirect state in authorization URL.");
  }

  return {
    authorizationUrl,
    state,
  };
}

async function parseStartedProviderAppSetupRedirect(response: {
  json: () => Promise<unknown>;
}): Promise<StartedProviderAppSetupRedirect> {
  const responseBody = StartedProviderAppSetupResponseSchema.parse(await response.json());
  if (responseBody.kind !== "redirect") {
    throw new Error("Expected provider app setup start to return a redirect.");
  }

  return responseBody;
}

async function expectRedirectSession(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    targetKey: string;
    state: string;
  },
): Promise<void> {
  const redirectSession =
    await env.controlPlaneDb.query.integrationConnectionRedirectSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.targetKey, input.targetKey),
          eq(table.state, input.state),
        ),
    });

  if (redirectSession === undefined) {
    throw new Error("Expected persisted redirect session.");
  }

  expect(Date.parse(redirectSession.expiresAt)).toBeGreaterThan(
    Date.parse(redirectSession.createdAt),
  );
  expect(redirectSession.usedAt).toBeNull();
}

async function startGitHubApiServer(): Promise<StartedGitHubApiServer> {
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

    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify([]));
  });

  await listen(server, { host, port });

  return {
    baseUrl: `http://${host}:${port.toString()}`,
    requests,
    stop: async () => close(server),
  };
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
