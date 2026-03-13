// @vitest-environment jsdom

import { createServer } from "node:http";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationsPage } from "../src/features/pages/integrations-page.js";

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
                supportedAuthSchemes: ["oauth"],
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
                config: {
                  auth_scheme: "oauth",
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

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });
      const router = createMemoryRouter(
        createRoutesFromElements(
          <Route
            element={<IntegrationsPage />}
            path="/settings/organization/integrations/:targetKey"
          />,
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

      const initialRefreshButtons = await screen.findAllByRole("button", {
        name: "Refresh resources",
      });
      const repositoriesRefreshButton = initialRefreshButtons[0];
      const organizationsRefreshButton = initialRefreshButtons[1];

      if (repositoriesRefreshButton === undefined || organizationsRefreshButton === undefined) {
        throw new Error("Expected two refresh buttons to be present.");
      }

      fireEvent.click(repositoriesRefreshButton);

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Refreshing..." })).toHaveLength(1);
      });

      fireEvent.click(organizationsRefreshButton);

      await waitFor(() => {
        expect(refreshRequestKinds).toEqual(["repositories", "organizations"]);
        expect(screen.getAllByRole("button", { name: "Refreshing..." })).toHaveLength(2);
      });

      repositoriesRefresh.resolve();
      organizationsRefresh.resolve();

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Refresh resources" })).toHaveLength(2);
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
