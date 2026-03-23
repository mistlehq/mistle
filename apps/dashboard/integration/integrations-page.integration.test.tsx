// @vitest-environment jsdom

import { createServer } from "node:http";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../src/config.js";
import { ROUTE_HANDLES } from "../src/features/navigation/route-handles.js";
import { IntegrationsPage } from "../src/features/pages/integrations-page.js";
import { SettingsLayout } from "../src/features/settings/settings-layout.js";

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

describe("IntegrationsPage resource refresh concurrency", () => {
  afterEach(() => {
    cleanup();
    resetDashboardConfigForTest();
  });

  it("keeps each resource in refreshing state while overlapping refresh requests are pending", async () => {
    const repositoriesRefresh = createDeferredPromise<void>();
    const organizationsRefresh = createDeferredPromise<void>();
    const refreshRequestKinds: string[] = [];

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/v1/integration/targets") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            items: [
              {
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
                    kind: "redirect",
                  },
                ],
                targetHealth: {
                  configStatus: "valid",
                },
              },
            ],
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
        requestUrl.pathname === "/v1/integration/connections/icn_123/resources/repositories/refresh"
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

    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server did not return an address.");
      }

      Object.assign(import.meta.env, {
        VITE_CONTROL_PLANE_API_ORIGIN: `http://127.0.0.1:${address.port}`,
      });
      resetDashboardConfigForTest();

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });
      const router = createMemoryRouter(
        createRoutesFromElements(
          <Route element={<Outlet />} path="/">
            <Route element={<SettingsLayout />} handle={ROUTE_HANDLES.settings} path="settings">
              <Route
                element={<Outlet />}
                handle={ROUTE_HANDLES.settingsOrganization}
                path="organization"
              >
                <Route
                  element={<Outlet />}
                  handle={ROUTE_HANDLES.settingsOrganizationIntegrations}
                  path="integrations"
                >
                  <Route
                    element={<IntegrationsPage />}
                    handle={ROUTE_HANDLES.settingsOrganizationIntegrationDetail}
                    path=":targetKey"
                  />
                </Route>
              </Route>
            </Route>
          </Route>,
        ),
        {
          initialEntries: ["/settings/organization/integrations/github"],
        },
      );

      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );

      const connectionNameMatches = await screen.findAllByText("Engineering GitHub");
      expect(connectionNameMatches.length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText("Connected")).toBeNull();
      expect(screen.queryByText("Available Integrations")).toBeNull();
      expect(screen.queryByText("Integration connection")).toBeNull();
      expect(screen.getByText("GitHub")).toBeTruthy();

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
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("offers delete for unbound connections and calls the delete endpoint", async () => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/v1/integration/targets") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            items: [
              {
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
                    kind: "redirect",
                  },
                ],
                targetHealth: {
                  configStatus: "valid",
                },
              },
            ],
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

    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server did not return an address.");
      }

      Object.assign(import.meta.env, {
        VITE_CONTROL_PLANE_API_ORIGIN: `http://127.0.0.1:${address.port}`,
      });
      resetDashboardConfigForTest();

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });
      const router = createMemoryRouter(
        createRoutesFromElements(
          <Route element={<Outlet />} path="/">
            <Route element={<SettingsLayout />} handle={ROUTE_HANDLES.settings} path="settings">
              <Route
                element={<Outlet />}
                handle={ROUTE_HANDLES.settingsOrganization}
                path="organization"
              >
                <Route
                  element={<Outlet />}
                  handle={ROUTE_HANDLES.settingsOrganizationIntegrations}
                  path="integrations"
                >
                  <Route
                    element={<IntegrationsPage />}
                    handle={ROUTE_HANDLES.settingsOrganizationIntegrationDetail}
                    path=":targetKey"
                  />
                </Route>
              </Route>
            </Route>
          </Route>,
        ),
        {
          initialEntries: ["/settings/organization/integrations/github"],
        },
      );

      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );

      expect(await screen.findByText("Bound GitHub")).toBeTruthy();
      expect(await screen.findByText("Free GitHub")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Delete connection Bound GitHub" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Delete connection Free GitHub" }));
      expect(await screen.findByText("Delete integration connection")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Delete connection" }));

      await waitFor(() => {
        expect(screen.queryByText("Delete integration connection")).toBeNull();
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
