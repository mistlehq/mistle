// @vitest-environment jsdom

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, type MemoryRouterProps, Route, Routes, useLocation } from "react-router";
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
    cleanup();
    Object.assign(import.meta.env, {
      VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
    });
    resetDashboardConfigForTest();
  });

  it("selects the route-requested connection after a stale directory response refreshes", async () => {
    configureDashboardBuildConfigForTest("https://control-plane.example.com");

    const queryClient = createLoadedIntegrationsQueryClient({
      targets: [createGitHubTarget()],
      connections: [
        createGitHubConnection({
          id: "icn_first",
          displayName: "First GitHub",
          installationId: "111",
        }),
      ],
    });

    renderIntegrationsPage({
      initialEntries: ["/integrations/github-cloud?connectionId=icn_newly_installed"],
      queryClient,
    });

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

  it("shows Slack install success on the selected connection detail route", async () => {
    configureDashboardBuildConfigForTest("https://control-plane.example.com");

    const queryClient = createLoadedIntegrationsQueryClient({
      targets: [createSlackTarget()],
      connections: [
        createSlackConnection({
          id: "icn_slack_installed",
          displayName: "Engineering Slack",
        }),
      ],
    });

    renderIntegrationsPage({
      element: <IntegrationsPageWithLocationSearch />,
      initialEntries: [
        "/integrations/slack-default?connectionId=icn_slack_installed&connectionNotice=installed",
      ],
      queryClient,
    });

    const successNoticeTitle = screen.getByText(
      "The Slack app was created and connected to Mistle successfully",
    );
    expect(successNoticeTitle).toBeTruthy();
    expect(
      screen.queryByText("The Slack app was created in Slack and connected to Mistle."),
    ).toBeNull();
    expectNoticeInsideSelectedDetailPane(successNoticeTitle, "Slack");
    expect(
      screen
        .getByRole("button", { name: "Select connection Engineering Slack" })
        .getAttribute("aria-current"),
    ).toBe("true");
    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).toBe(
        "?connectionId=icn_slack_installed",
      );
    });
  });

  it("shows GitHub App install success on the selected connection detail route", async () => {
    configureDashboardBuildConfigForTest("https://control-plane.example.com");

    const queryClient = createLoadedIntegrationsQueryClient({
      targets: [createGitHubTarget()],
      connections: [
        createGitHubConnection({
          id: "icn_github_installed",
          displayName: "Engineering GitHub",
          installationId: "12345",
        }),
      ],
    });

    renderIntegrationsPage({
      element: <IntegrationsPageWithLocationSearch />,
      initialEntries: [
        "/integrations/github-cloud?connectionId=icn_github_installed&connectionNotice=installed",
      ],
      queryClient,
    });

    const successNoticeTitle = screen.getByText("GitHub App connected to Mistle successfully");
    expect(successNoticeTitle).toBeTruthy();
    expect(
      screen.queryByText("Mistle is now connected to this GitHub App installation."),
    ).toBeNull();
    expectNoticeInsideSelectedDetailPane(successNoticeTitle, "GitHub");
    expect(
      screen
        .getByRole("button", { name: "Select connection Engineering GitHub" })
        .getAttribute("aria-current"),
    ).toBe("true");
    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).toBe(
        "?connectionId=icn_github_installed",
      );
    });
  });

  it("shows Jira webhook setup success on the selected connection detail route", () => {
    configureDashboardBuildConfigForTest("https://control-plane.example.com");

    const queryClient = createLoadedIntegrationsQueryClient({
      targets: [createJiraTarget()],
      connections: [
        createJiraConnection({
          id: "icn_jira_created",
          displayName: "Engineering Jira",
        }),
      ],
    });

    renderIntegrationsPage({
      initialEntries: [
        {
          pathname: "/integrations/jira-default",
          search: "?connectionId=icn_jira_created",
          state: {
            managedWebhookSetup: {
              status: "created",
              webhookSourceId: "iws_jira_created",
            },
          },
        },
      ],
      queryClient,
    });

    const successNoticeTitle = screen.getByText("Jira connection and webhook created successfully");
    expect(successNoticeTitle).toBeTruthy();
    expectNoticeInsideSelectedDetailPane(successNoticeTitle, "Jira success");
    expect(
      screen
        .getByRole("button", { name: "Select connection Engineering Jira" })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("shows Jira webhook setup failure from route state on the selected connection detail route", () => {
    configureDashboardBuildConfigForTest("https://control-plane.example.com");
    const webhookSetupFailureMessage = "Jira admin webhook creation failed (403): Forbidden";

    const queryClient = createLoadedIntegrationsQueryClient({
      targets: [createJiraTarget()],
      connections: [
        createJiraConnection({
          id: "icn_jira_created",
          displayName: "Engineering Jira",
        }),
      ],
    });

    renderIntegrationsPage({
      initialEntries: [
        {
          pathname: "/integrations/jira-default",
          search: "?connectionId=icn_jira_created",
          state: {
            managedWebhookSetup: {
              status: "failed",
              message: webhookSetupFailureMessage,
            },
          },
        },
      ],
      queryClient,
    });

    const failureNoticeTitle = screen.getByText("Connection created, webhook setup failed");
    expect(failureNoticeTitle).toBeTruthy();
    expect(screen.getByText(webhookSetupFailureMessage)).toBeTruthy();
    expectNoticeInsideSelectedDetailPane(failureNoticeTitle, "Jira failure");
    expect(
      screen
        .getByRole("button", { name: "Select connection Engineering Jira" })
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
      configureDashboardBuildConfigForTest(server.origin);

      const queryClient = createLoadedIntegrationsQueryClient({
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

      renderIntegrationsPage({
        initialEntries: ["/integrations/github-cloud?connectionId=icn_newly_installed"],
        queryClient,
      });

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

function IntegrationsPageWithLocationSearch() {
  const location = useLocation();

  return (
    <>
      <IntegrationsPage />
      <span data-testid="location-search">{location.search}</span>
    </>
  );
}

function renderIntegrationsPage(input: {
  element?: ReactNode;
  initialEntries: NonNullable<MemoryRouterProps["initialEntries"]>;
  queryClient: QueryClient;
}): void {
  render(
    <QueryClientProvider client={input.queryClient}>
      <MemoryRouter initialEntries={input.initialEntries}>
        <Routes>
          <Route element={input.element ?? <IntegrationsPage />} path="/integrations/:targetKey" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function configureDashboardBuildConfigForTest(controlPlaneApiOrigin: string): void {
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: controlPlaneApiOrigin,
  });
  resetDashboardConfigForTest();
}

function createLoadedIntegrationsQueryClient(input: {
  targets: readonly IntegrationTarget[];
  connections: readonly IntegrationConnection[];
}): QueryClient {
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
    targets: input.targets,
    connections: input.connections,
  });
  return queryClient;
}

function expectNoticeInsideSelectedDetailPane(noticeTitle: HTMLElement, noticeName: string): void {
  const noticeSection = noticeTitle.closest("section");
  const selectedConnectionTitleSection = screen
    .getByRole("textbox", { name: "Connection name" })
    .closest("section");
  if (noticeSection === null || selectedConnectionTitleSection === null) {
    throw new Error(`Expected ${noticeName} notice to render inside the selected detail pane.`);
  }
  expect(noticeSection).toBe(selectedConnectionTitleSection);
}

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

function createJiraTarget(): IntegrationTarget {
  return {
    targetKey: "jira-default",
    familyId: "jira",
    variantId: "jira-default",
    enabled: true,
    config: {},
    displayName: "Jira",
    description: "Jira Cloud",
    targetHealth: {
      configStatus: "valid",
    },
    connectionMethods: [
      {
        id: "jira-personal-api-token",
        label: "Personal API token",
        kind: "form",
        secretFields: [
          {
            name: "apiKey",
            label: "API token",
            inputType: "password",
          },
        ],
      },
    ],
  };
}

function createJiraConnection(input: { id: string; displayName: string }): IntegrationConnection {
  return {
    id: input.id,
    targetKey: "jira-default",
    displayName: input.displayName,
    status: "active",
    bindingCount: 0,
    connectionMethodId: "jira-personal-api-token",
    connectionMethodLabel: "Personal API token",
    externalSubjectId: "https://engineering.atlassian.net",
    configuredSecretNames: ["apiKey"],
    config: {
      connection_method: "jira-personal-api-token",
      site_url: "https://engineering.atlassian.net",
      email: "ops@example.com",
    },
    resources: [],
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z",
  };
}
