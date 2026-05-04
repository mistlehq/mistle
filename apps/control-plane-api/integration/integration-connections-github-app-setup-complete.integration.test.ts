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

import { CompleteProviderAppSetupCallbackBadRequestResponseSchema } from "../src/integration-callbacks/provider-app-setup/schema.js";
import { CreatedFormIntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import { StartedProviderAppSetupResponseSchema } from "../src/integration-connections/start-provider-app-setup/schema.js";
import { createFormConnection, seedIntegrationTarget } from "./helpers/integration-connections.js";

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

describe.concurrent("GitHub App setup completion integration connections", () => {
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
  state: string;
  installationId: string;
}): string {
  const searchParams = new URLSearchParams({
    state: input.state,
    installation_id: input.installationId,
    setup_action: "install",
  });
  return `/p/integration/callbacks/setup/github-app-installation?${searchParams.toString()}`;
}

async function startGitHubApiServer(input: {
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

    response.statusCode = input.statusCode ?? 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(input.responseBody));
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
