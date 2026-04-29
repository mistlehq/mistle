// @vitest-environment jsdom

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import {
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
  useLocation,
} from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../src/config.js";
import { resetAuthClientForTest } from "../src/lib/auth/client.js";
import { resetControlPlaneApiClientForTest } from "../src/lib/control-plane-api/client.js";
import { seedAuthenticatedSession } from "../src/test-support/auth-session.js";
import { createTestQueryClient } from "../src/test-support/query-client.js";

function installMatchMediaStub(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function RouteProbe(): React.JSX.Element {
  const location = useLocation();

  return <div data-testid="route-probe">{location.pathname}</div>;
}

function createAppShellRouter(input: {
  appShell: ComponentType;
}): ReturnType<typeof createMemoryRouter> {
  return createMemoryRouter(
    createRoutesFromElements(
      <Route element={<input.appShell />} path="/">
        <Route
          element={<RouteProbe />}
          handle={{
            appShellInsetOwner: "child",
            breadcrumb: "Integrations",
            title: "Integrations",
          }}
          path="integrations"
        />
        <Route
          element={<RouteProbe />}
          handle={{ breadcrumb: "Sessions", title: "Sessions" }}
          path="sessions"
        />
        <Route
          element={<RouteProbe />}
          handle={{
            appShellInsetOwner: "child",
            breadcrumb: "New",
            title: "New session",
            description: "Start a sandbox-backed session from a sandbox profile.",
          }}
          path="sessions/new"
        />
        <Route
          element={<RouteProbe />}
          handle={{
            hideBreadcrumb: true,
            title: "Session",
            description: "Interact with one sandbox-backed Codex session.",
          }}
          path="sessions/:sandboxInstanceId"
        />
        <Route element={<Outlet />} path="*" />
      </Route>,
    ),
    {
      initialEntries: ["/integrations"],
    },
  );
}

type DashboardRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) => void;

async function startDashboardServer(input: {
  handler: DashboardRequestHandler;
}): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(input.handler);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not return an address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeIdleConnections();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function renderAppShellIntegration(input: { handler: DashboardRequestHandler }): Promise<{
  close: () => Promise<void>;
  queryClient: QueryClient;
}> {
  const server = await startDashboardServer({
    handler: input.handler,
  });

  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: server.baseUrl,
  });
  resetDashboardConfigForTest();
  resetAuthClientForTest();
  resetControlPlaneApiClientForTest();

  const queryClient = createTestQueryClient();
  seedAuthenticatedSession(queryClient);
  const { AppShell } = await import("../src/features/shell/app-shell.js");

  const router = createAppShellRouter({
    appShell: AppShell,
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return {
    close: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      cleanup();
      resetDashboardConfigForTest();
      resetAuthClientForTest();
      resetControlPlaneApiClientForTest();
      await server.close();
    },
    queryClient,
  };
}

describe("AppShell sessions sidebar toggle integration", () => {
  installMatchMediaStub();

  afterEach(() => {
    cleanup();
  });

  it("returns to the previous route after toggling sidebar mode on and back off", async () => {
    const renderedPage = await renderAppShellIntegration({
      handler: (request, response) => {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

        if (
          request.method === "GET" &&
          requestUrl.pathname === "/organization/get-full-organization" &&
          requestUrl.searchParams.get("organizationId") === "org_123"
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              name: "Acme",
            }),
          );
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/organization/list") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify([
              {
                id: "org_123",
                name: "Acme",
              },
            ]),
          );
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/v1/organization/logo") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              hasImage: false,
              imageVersion: null,
            }),
          );
          return;
        }

        if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/instances") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              items: [],
              nextPage: null,
              previousPage: null,
              totalResults: 0,
            }),
          );
          return;
        }

        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "Not found" }));
      },
    });

    try {
      await waitFor(() => {
        expect(screen.getByTestId("route-probe").textContent).toBe("/integrations");
      });

      fireEvent.click(screen.getByRole("switch", { name: "Toggle sessions sidebar view" }));

      await waitFor(() => {
        expect(screen.getByTestId("route-probe").textContent).toBe("/sessions/new");
      });

      fireEvent.click(screen.getByRole("switch", { name: "Toggle sessions sidebar view" }));

      await waitFor(() => {
        expect(screen.getByTestId("route-probe").textContent).toBe("/integrations");
      });
    } finally {
      await renderedPage.close();
    }
  }, 15_000);
});
