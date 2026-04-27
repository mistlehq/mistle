// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { ROUTE_HANDLES } from "../src/features/navigation/route-handles.js";
import { IntegrationConnectionGitHubAppSetupPage } from "../src/features/pages/integration-connection-github-app-setup-page.js";
import { IntegrationsPage } from "../src/features/pages/integrations-page.js";
import { renderDashboardPageIntegration } from "./helpers/dashboard-page.js";

function createDeferredPromise<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolveValue) => {
    resolve = resolveValue;
  });

  return {
    promise,
    resolve,
  };
}

function createGitHubTarget() {
  return {
    targetKey: "github",
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {},
    displayName: "GitHub",
    description: "Bring GitHub into Mistle.",
    connectionMethods: [
      {
        id: "github-app-installation",
        label: "GitHub App installation",
        kind: "form" as const,
        secretFields: [
          {
            name: "appPrivateKeyPem",
            label: "App private key PEM",
            inputType: "textarea" as const,
          },
          {
            name: "webhookSecret",
            label: "Webhook secret",
            inputType: "password" as const,
          },
        ],
      },
    ],
    targetHealth: {
      configStatus: "valid" as const,
    },
  };
}

function createIntegrationsRouter(
  initialEntries: string[] = ["/integrations/github"],
): ReturnType<typeof createMemoryRouter> {
  return createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Outlet />} path="/">
        <Route element={<Outlet />} handle={ROUTE_HANDLES.integrations} path="integrations">
          <Route handle={ROUTE_HANDLES.integrationDetail} path=":targetKey">
            <Route element={<IntegrationsPage />} index />
            <Route
              element={<IntegrationConnectionGitHubAppSetupPage />}
              handle={ROUTE_HANDLES.integrationGitHubAppSetup}
              path=":connectionId/github-app/setup"
            />
          </Route>
        </Route>
      </Route>,
    ),
    {
      initialEntries,
    },
  );
}

describe("IntegrationsPage resource refresh concurrency", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps each resource in refreshing state while overlapping refresh requests are pending", async () => {
    const repositoriesRefresh = createDeferredPromise<void>();
    const organizationsRefresh = createDeferredPromise<void>();
    const refreshRequestKinds: string[] = [];

    const renderedPage = await renderDashboardPageIntegration({
      handler: (request, response) => {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

        if (request.method === "GET" && requestUrl.pathname === "/v1/integration/targets") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              items: [createGitHubTarget()],
              nextPage: null,
              previousPage: null,
              totalResults: 1,
            }),
          );
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/v1/integration/connections") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              items: [
                {
                  id: "icn_123",
                  targetKey: "github",
                  displayName: "Engineering GitHub",
                  status: "active",
                  bindingCount: 0,
                  config: {
                    connection_method: "github-app-installation",
                    app_id: "123",
                    app_slug: "mistle-github-app",
                  },
                  resources: [
                    {
                      kind: "repositories",
                      selectionMode: "multi",
                      count: 42,
                      syncState: "ready",
                      lastSyncedAt: "2026-03-11T04:25:00.000Z",
                    },
                    {
                      kind: "organizations",
                      selectionMode: "single",
                      count: 1,
                      syncState: "ready",
                      lastSyncedAt: "2026-03-11T04:25:00.000Z",
                    },
                  ],
                  createdAt: "2026-03-03T00:00:00.000Z",
                  updatedAt: "2026-03-11T04:30:00.000Z",
                },
              ],
              nextPage: null,
              previousPage: null,
              totalResults: 1,
            }),
          );
          return;
        }

        if (
          request.method === "POST" &&
          requestUrl.pathname ===
            "/v1/integration/connections/icn_123/resources/repositories/refresh"
        ) {
          refreshRequestKinds.push("repositories");
          void repositoriesRefresh.promise.then(() => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                connectionId: "icn_123",
                familyId: "github",
                kind: "repositories",
                syncState: "syncing",
              }),
            );
          });
          return;
        }

        if (
          request.method === "POST" &&
          requestUrl.pathname ===
            "/v1/integration/connections/icn_123/resources/organizations/refresh"
        ) {
          refreshRequestKinds.push("organizations");
          void organizationsRefresh.promise.then(() => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                connectionId: "icn_123",
                familyId: "github",
                kind: "organizations",
                syncState: "syncing",
              }),
            );
          });
          return;
        }

        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "Not found" }));
      },
      ui: <RouterProvider router={createIntegrationsRouter()} />,
    });

    try {
      const repositoriesRefreshButton = await screen.findByRole("button", {
        name: "Refresh repositories",
      });
      await screen.findByRole("button", {
        name: "Refresh organizations",
      });

      fireEvent.click(repositoriesRefreshButton);

      await waitFor(() => {
        expect(refreshRequestKinds).toEqual(["repositories"]);
      });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Refresh repositories" })).toHaveProperty(
          "disabled",
          true,
        );
        expect(screen.getByRole("button", { name: "Refresh organizations" })).toHaveProperty(
          "disabled",
          false,
        );
      });

      fireEvent.click(screen.getByRole("button", { name: "Refresh organizations" }));

      await waitFor(() => {
        expect(refreshRequestKinds).toEqual(["repositories", "organizations"]);
        expect(screen.getByRole("button", { name: "Refresh repositories" })).toHaveProperty(
          "disabled",
          true,
        );
        expect(screen.getByRole("button", { name: "Refresh organizations" })).toHaveProperty(
          "disabled",
          true,
        );
      });

      repositoriesRefresh.resolve();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Refresh repositories" })).toHaveProperty(
          "disabled",
          false,
        );
        expect(screen.getByRole("button", { name: "Refresh organizations" })).toHaveProperty(
          "disabled",
          true,
        );
      });

      organizationsRefresh.resolve();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Refresh repositories" })).toHaveProperty(
          "disabled",
          false,
        );
        expect(screen.getByRole("button", { name: "Refresh organizations" })).toHaveProperty(
          "disabled",
          false,
        );
      });
    } finally {
      await renderedPage.close();
    }
  });

  it("offers delete for unbound connections and calls the delete endpoint", async () => {
    const renderedPage = await renderDashboardPageIntegration({
      handler: (request, response) => {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

        if (request.method === "GET" && requestUrl.pathname === "/v1/integration/targets") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              items: [createGitHubTarget()],
              nextPage: null,
              previousPage: null,
              totalResults: 1,
            }),
          );
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/v1/integration/connections") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              items: [
                {
                  id: "icn_bound",
                  targetKey: "github",
                  displayName: "Bound GitHub",
                  status: "active",
                  bindingCount: 1,
                  config: {
                    connection_method: "github-app-installation",
                    app_id: "123",
                    app_slug: "mistle-github-app",
                  },
                  createdAt: "2026-03-03T00:00:00.000Z",
                  updatedAt: "2026-03-11T04:30:00.000Z",
                },
                {
                  id: "icn_free",
                  targetKey: "github",
                  displayName: "Free GitHub",
                  status: "active",
                  bindingCount: 0,
                  config: {
                    connection_method: "github-app-installation",
                    app_id: "123",
                    app_slug: "mistle-github-app",
                  },
                  createdAt: "2026-03-03T00:00:00.000Z",
                  updatedAt: "2026-03-11T04:30:00.000Z",
                },
              ],
              nextPage: null,
              previousPage: null,
              totalResults: 2,
            }),
          );
          return;
        }

        if (
          request.method === "DELETE" &&
          requestUrl.pathname === "/v1/integration/connections/icn_free"
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              connectionId: "icn_free",
            }),
          );
          return;
        }

        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "Not found" }));
      },
      ui: <RouterProvider router={createIntegrationsRouter()} />,
    });

    try {
      expect(
        await screen.findByRole("button", { name: "Delete connection Bound GitHub" }),
      ).toHaveProperty("disabled", true);

      fireEvent.click(screen.getByRole("button", { name: "Select connection Free GitHub" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete connection Free GitHub" }));
      expect(await screen.findByText("Delete integration connection")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Delete connection" }));

      await waitFor(() => {
        expect(screen.queryByText("Delete integration connection")).toBeNull();
      });
    } finally {
      await renderedPage.close();
    }
  });

  it("keeps the GitHub App install action in its pending state after the redirect URL is returned", async () => {
    let startRequestCount = 0;

    const renderedPage = await renderDashboardPageIntegration({
      handler: (request, response) => {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

        if (request.method === "GET" && requestUrl.pathname === "/v1/integration/targets") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              items: [createGitHubTarget()],
              nextPage: null,
              previousPage: null,
              totalResults: 1,
            }),
          );
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/v1/integration/connections") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              items: [
                {
                  id: "icn_install",
                  targetKey: "github",
                  displayName: "Install GitHub",
                  status: "active",
                  bindingCount: 0,
                  connectionMethodId: "github-app-installation",
                  connectionMethodLabel: "GitHub App installation",
                  config: {
                    connection_method: "github-app-installation",
                    app_id: "123",
                    app_slug: "mistle-github-app",
                    client_id: "Iv1.123",
                  },
                  configuredSecretNames: ["clientSecret", "appPrivateKeyPem", "webhookSecret"],
                  createdAt: "2026-03-03T00:00:00.000Z",
                  updatedAt: "2026-03-11T04:30:00.000Z",
                },
              ],
              nextPage: null,
              previousPage: null,
              totalResults: 1,
            }),
          );
          return;
        }

        if (
          request.method === "GET" &&
          requestUrl.pathname === "/v1/integration/connections/icn_install/webhook-sources"
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify([]));
          return;
        }

        if (
          request.method === "POST" &&
          requestUrl.pathname ===
            "/v1/integration/connections/icn_install/github-app-installation/start"
        ) {
          startRequestCount += 1;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              authorizationUrl: new URL("#install-github-app", globalThis.location.href).toString(),
            }),
          );
          return;
        }

        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "Not found" }));
      },
      ui: (
        <RouterProvider
          router={createIntegrationsRouter(["/integrations/github/icn_install/github-app/setup"])}
        />
      ),
    });

    try {
      const installButton = await screen.findByRole("button", { name: "Install GitHub App" });
      await waitFor(() => {
        expect(installButton).toHaveProperty("disabled", false);
      });
      fireEvent.click(installButton);

      await waitFor(() => {
        expect(startRequestCount).toBe(1);
        expect(installButton.getAttribute("aria-busy")).toBe("true");
        expect(installButton).toHaveProperty("disabled", true);
      });
    } finally {
      await renderedPage.close();
    }
  });
});
