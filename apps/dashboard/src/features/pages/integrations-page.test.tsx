// @vitest-environment jsdom

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../../config.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { IntegrationsPage } from "./integrations-page.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

type ServerRequestRecord = {
  method: string;
  pathname: string;
};

type ServerHandler = (request: ServerRequestRecord) =>
  | {
      status: number;
      body: unknown;
    }
  | Promise<{
      status: number;
      body: unknown;
    }>;

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: () => {
      resolvePromise?.();
    },
  };
}

async function startControlPlaneTestServer(input: { handler: ServerHandler }): Promise<{
  origin: string;
  requests: ServerRequestRecord[];
  close: () => Promise<void>;
}> {
  const requests: ServerRequestRecord[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestRecord: ServerRequestRecord = {
      method: request.method ?? "GET",
      pathname: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
    };
    requests.push(requestRecord);

    const handled = await input.handler(requestRecord);
    response.statusCode = handled.status;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(handled.body));
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP server address.");
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

describe("IntegrationsPage", () => {
  afterEach(() => {
    globalThis.__MISTLE_RUNTIME_CONFIG__ = undefined;
    resetDashboardConfigForTest();
  });

  it("selects the route-requested connection after a stale directory response refreshes", async () => {
    globalThis.__MISTLE_RUNTIME_CONFIG__ = {
      controlPlaneApiOrigin: "https://control-plane.example.com",
    };
    resetDashboardConfigForTest();

    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SESSION_QUERY_KEY, {
      session: {
        activeOrganizationId: "org_mistle",
      },
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [createGitHubTarget()],
      connections: [
        createGitHubConnection({
          id: "icn_first",
          displayName: "First GitHub",
          installationId: "111",
        }),
      ],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/integrations/github-cloud?connectionId=icn_newly_installed"]}
        >
          <Routes>
            <Route element={<IntegrationsPage />} path="/integrations/:targetKey" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      screen
        .getByRole("button", { name: "Select connection First GitHub" })
        .getAttribute("aria-current"),
    ).toBe("true");

    act(() => {
      queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
        targets: [createGitHubTarget()],
        connections: [
          createGitHubConnection({
            id: "icn_first",
            displayName: "First GitHub",
            installationId: "111",
          }),
          createGitHubConnection({
            id: "icn_newly_installed",
            displayName: "Newly Installed GitHub",
            installationId: "222",
          }),
        ],
      });
    });

    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Select connection Newly Installed GitHub" })
          .getAttribute("aria-current"),
      ).toBe("true");
    });
    expect(
      screen
        .getByRole("button", { name: "Select connection First GitHub" })
        .hasAttribute("aria-current"),
    ).toBe(false);
  });

  it("shows Slack install success on the selected connection detail route", () => {
    globalThis.__MISTLE_RUNTIME_CONFIG__ = {
      controlPlaneApiOrigin: "https://control-plane.example.com",
    };
    resetDashboardConfigForTest();

    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SESSION_QUERY_KEY, {
      session: {
        activeOrganizationId: "org_mistle",
      },
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [createSlackTarget()],
      connections: [
        createSlackConnection({
          id: "icn_slack_installed",
          displayName: "Engineering Slack",
        }),
      ],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            "/integrations/slack-default?connectionId=icn_slack_installed&slackApp=installed",
          ]}
        >
          <Routes>
            <Route element={<IntegrationsPage />} path="/integrations/:targetKey" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const successNoticeTitle = screen.getByText("Slack app installed and connected");
    expect(successNoticeTitle).toBeTruthy();
    expect(
      screen.getByText("The Slack app was created in Slack and connected to Mistle."),
    ).toBeTruthy();
    const successNoticeSection = successNoticeTitle.closest("section");
    const selectedConnectionTitleSection = screen
      .getByRole("textbox", { name: "Connection name" })
      .closest("section");
    if (successNoticeSection === null || selectedConnectionTitleSection === null) {
      throw new Error("Expected Slack success notice to render inside the selected detail pane.");
    }
    expect(successNoticeSection).toBe(selectedConnectionTitleSection);
    expect(
      screen
        .getByRole("button", { name: "Select connection Engineering Slack" })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("shows GitHub App install success on the selected connection detail route", () => {
    globalThis.__MISTLE_RUNTIME_CONFIG__ = {
      controlPlaneApiOrigin: "https://control-plane.example.com",
    };
    resetDashboardConfigForTest();

    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SESSION_QUERY_KEY, {
      session: {
        activeOrganizationId: "org_mistle",
      },
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [createGitHubTarget()],
      connections: [
        createGitHubConnection({
          id: "icn_github_installed",
          displayName: "Engineering GitHub",
          installationId: "12345",
        }),
      ],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            "/integrations/github-cloud?connectionId=icn_github_installed&githubApp=installed",
          ]}
        >
          <Routes>
            <Route element={<IntegrationsPage />} path="/integrations/:targetKey" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const successNoticeTitle = screen.getByText("GitHub App connected to Mistle successfully");
    expect(successNoticeTitle).toBeTruthy();
    expect(
      screen.queryByText("Mistle is now connected to this GitHub App installation."),
    ).toBeNull();
    const successNoticeSection = successNoticeTitle.closest("section");
    const selectedConnectionTitleSection = screen
      .getByRole("textbox", { name: "Connection name" })
      .closest("section");
    if (successNoticeSection === null || selectedConnectionTitleSection === null) {
      throw new Error("Expected GitHub success notice to render inside the selected detail pane.");
    }
    expect(successNoticeSection).toBe(selectedConnectionTitleSection);
    expect(
      screen
        .getByRole("button", { name: "Select connection Engineering GitHub" })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("starts a refresh-all resource sync when a newly connected route connection has no synced resources", async () => {
    const refreshResponseDeferred = createDeferred();
    const server = await startControlPlaneTestServer({
      handler: async (request) => {
        if (
          request.method === "POST" &&
          request.pathname === "/v1/integration/connections/icn_newly_installed/resources/refresh"
        ) {
          await refreshResponseDeferred.promise;
          return {
            status: 202,
            body: {
              connectionId: "icn_newly_installed",
              familyId: "github",
              resources: [
                {
                  kind: "repositories",
                  syncState: "syncing",
                },
              ],
            },
          };
        }

        return {
          status: 404,
          body: {
            code: "NOT_FOUND",
            message: "Unhandled test route.",
          },
        };
      },
    });

    try {
      globalThis.__MISTLE_RUNTIME_CONFIG__ = {
        controlPlaneApiOrigin: server.origin,
      };
      resetDashboardConfigForTest();

      const queryClient = createTestQueryClient({
        refetchOnMount: false,
        staleTime: Number.POSITIVE_INFINITY,
      });
      queryClient.setQueryData(SESSION_QUERY_KEY, {
        session: {
          activeOrganizationId: "org_mistle",
        },
      });
      queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
        targets: [createGitHubTarget()],
        connections: [
          createGitHubConnection({
            id: "icn_newly_installed",
            displayName: "Newly Installed GitHub",
            installationId: "222",
            resources: [
              {
                kind: "repositories",
                selectionMode: "multi",
                count: 0,
                syncState: "never-synced",
              },
            ],
          }),
        ],
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter
            initialEntries={["/integrations/github-cloud?connectionId=icn_newly_installed"]}
          >
            <Routes>
              <Route element={<IntegrationsPage />} path="/integrations/:targetKey" />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(
          server.requests.some(
            (request) =>
              request.method === "POST" &&
              request.pathname ===
                "/v1/integration/connections/icn_newly_installed/resources/refresh",
          ),
        ).toBe(true);
      });

      expect(screen.getByRole("button", { name: "Refresh repositories" })).toHaveProperty(
        "disabled",
        true,
      );
    } finally {
      refreshResponseDeferred.resolve();
      await server.close();
    }
  });
});

function createGitHubTarget(): IntegrationTarget {
  return {
    targetKey: "github-cloud",
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {},
    displayName: "GitHub",
    description: "GitHub Cloud",
    targetHealth: {
      configStatus: "valid",
    },
    connectionMethods: [
      {
        id: "github-app-installation",
        label: "GitHub App installation",
        kind: "form",
        secretFields: [
          {
            name: "appPrivateKeyPem",
            label: "App private key",
            inputType: "textarea",
          },
        ],
      },
    ],
  };
}

function createGitHubConnection(input: {
  id: string;
  displayName: string;
  installationId: string;
  resources?: IntegrationConnection["resources"];
}): IntegrationConnection {
  return {
    id: input.id,
    targetKey: "github-cloud",
    displayName: input.displayName,
    status: "active",
    bindingCount: 0,
    connectionMethodId: "github-app-installation",
    connectionMethodLabel: "GitHub App installation",
    externalSubjectId: input.installationId,
    config: {
      connection_method: "github-app-installation",
      app_id: "3079908",
      app_slug: "jon-mistle-github",
      client_id: "Iv1.client",
      installation_id: input.installationId,
    },
    resources: input.resources ?? [],
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
  };
}

function createSlackTarget(): IntegrationTarget {
  return {
    targetKey: "slack-default",
    familyId: "slack",
    variantId: "slack-default",
    enabled: true,
    config: {},
    displayName: "Slack",
    description: "Slack",
    targetHealth: {
      configStatus: "valid",
    },
    connectionMethods: [
      {
        id: "slack-bot-token",
        label: "Slack app",
        kind: "form",
        secretFields: [
          {
            name: "botToken",
            label: "Bot token",
            inputType: "password",
          },
          {
            name: "signingSecret",
            label: "Signing secret",
            inputType: "password",
          },
        ],
      },
    ],
  };
}

function createSlackConnection(input: { id: string; displayName: string }): IntegrationConnection {
  return {
    id: input.id,
    targetKey: "slack-default",
    displayName: input.displayName,
    status: "active",
    bindingCount: 0,
    connectionMethodId: "slack-bot-token",
    connectionMethodLabel: "Slack app",
    externalSubjectId: "T0123456789",
    configuredSecretNames: ["botToken", "signingSecret", "clientSecret"],
    config: {
      connection_method: "slack-bot-token",
      client_id: "3555487893074.10993991013813",
      team_id: "T0123456789",
    },
    resources: [],
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}
