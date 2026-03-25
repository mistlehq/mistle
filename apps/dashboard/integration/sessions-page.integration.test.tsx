// @vitest-environment jsdom

import { createServer } from "node:http";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../src/config.js";
import { SessionsPage } from "../src/features/pages/sessions-page.js";
import { resetControlPlaneApiClientForTest } from "../src/lib/control-plane-api/client.js";
import { seedAuthenticatedSession } from "../src/test-support/auth-session.js";

describe("SessionsPage integration", () => {
  afterEach(() => {
    cleanup();
    resetDashboardConfigForTest();
    resetControlPlaneApiClientForTest();
  });

  it("renders sandbox instances from control plane and paginates through the list", async () => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/profiles/launchable") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            items: [
              {
                id: "sbp_profile_alpha",
                displayName: "Alpha Profile",
                status: "active",
                latestVersion: 2,
                createdAt: "2026-03-01T00:00:00.000Z",
                updatedAt: "2026-03-05T00:00:00.000Z",
              },
            ],
          }),
        );
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/instances") {
        const after = requestUrl.searchParams.get("after");

        response.writeHead(200, { "content-type": "application/json" });

        if (after === "cursor_page_2") {
          response.end(
            JSON.stringify({
              items: [
                {
                  id: "sbi_page_2",
                  sandboxProfileId: "sbp_profile_alpha",
                  sandboxProfileDisplayName: "Alpha Profile",
                  sandboxProfileVersion: 2,
                  status: "stopped",
                  startedBy: {
                    kind: "user",
                    id: "usr_456",
                    name: "Taylor Example",
                  },
                  source: "dashboard",
                  createdAt: "2026-03-12T12:00:00.000Z",
                  updatedAt: "2026-03-12T12:10:00.000Z",
                  failureCode: null,
                  failureMessage: null,
                },
              ],
              nextPage: null,
              previousPage: {
                before: "cursor_page_1",
                limit: 1,
              },
              totalResults: 2,
            }),
          );
          return;
        }

        response.end(
          JSON.stringify({
            items: [
              {
                id: "sbi_page_1",
                sandboxProfileId: "sbp_profile_alpha",
                sandboxProfileDisplayName: "Alpha Profile",
                sandboxProfileVersion: 1,
                status: "running",
                startedBy: {
                  kind: "user",
                  id: "usr_123",
                  name: "Jordan Example",
                },
                source: "dashboard",
                createdAt: "2026-03-11T12:00:00.000Z",
                updatedAt: "2026-03-11T12:10:00.000Z",
                failureCode: null,
                failureMessage: null,
              },
            ],
            nextPage: {
              after: "cursor_page_2",
              limit: 1,
            },
            previousPage: null,
            totalResults: 2,
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
      resetControlPlaneApiClientForTest();

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });
      seedAuthenticatedSession(queryClient);

      const rendered = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <SessionsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      try {
        expect(await screen.findByText("Start a new session")).toBeDefined();
        expect(await screen.findByText("Alpha Profile")).toBeDefined();
        expect(await screen.findByText("Jordan Example")).toBeDefined();
        expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", false);
        expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);

        fireEvent.click(screen.getByRole("button", { name: "Next" }));

        await waitFor(() => {
          expect(screen.queryByText("Jordan Example")).toBeNull();
          expect(screen.getByText("Taylor Example")).toBeDefined();
        });

        expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", false);
        expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
      } finally {
        rendered.unmount();
        await queryClient.cancelQueries();
        queryClient.clear();
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("renders session profile names directly from the sandbox instances query", async () => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/profiles/launchable") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            items: [],
          }),
        );
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/instances") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            items: [
              {
                id: "sbi_history",
                sandboxProfileId: "sbp_profile_hidden",
                sandboxProfileDisplayName: "Historical Profile",
                sandboxProfileVersion: 3,
                status: "running",
                startedBy: {
                  kind: "user",
                  id: "usr_123",
                  name: "Jordan Example",
                },
                source: "dashboard",
                createdAt: "2026-03-11T12:00:00.000Z",
                updatedAt: "2026-03-11T12:10:00.000Z",
                failureCode: null,
                failureMessage: null,
              },
            ],
            nextPage: null,
            previousPage: null,
            totalResults: 1,
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
      resetControlPlaneApiClientForTest();

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });
      seedAuthenticatedSession(queryClient);

      const rendered = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <SessionsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      try {
        expect(await screen.findByText("Historical Profile")).toBeDefined();
        expect(screen.getByRole("button", { name: "Start session" })).toHaveProperty(
          "disabled",
          true,
        );
      } finally {
        rendered.unmount();
        await queryClient.cancelQueries();
        queryClient.clear();
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("loads launchable profiles for the session picker from the dedicated endpoint", async () => {
    let launchableRequestCount = 0;

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/profiles/launchable") {
        response.writeHead(200, { "content-type": "application/json" });
        launchableRequestCount += 1;

        response.end(
          JSON.stringify({
            items: [
              {
                id: "sbp_profile_alpha",
                displayName: "Alpha Profile",
                status: "active",
                latestVersion: 2,
                createdAt: "2026-03-03T00:00:00.000Z",
                updatedAt: "2026-03-05T00:00:00.000Z",
              },
              {
                id: "sbp_profile_beta",
                displayName: "Beta Profile",
                status: "active",
                latestVersion: 1,
                createdAt: "2026-03-02T00:00:00.000Z",
                updatedAt: "2026-03-05T00:00:00.000Z",
              },
            ],
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
      resetControlPlaneApiClientForTest();

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });
      seedAuthenticatedSession(queryClient);

      const rendered = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <SessionsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      try {
        await waitFor(() => {
          expect(launchableRequestCount).toBe(1);
        });
        expect(screen.getByRole("combobox", { name: "Sandbox profile" })).toBeDefined();
      } finally {
        rendered.unmount();
        await queryClient.cancelQueries();
        queryClient.clear();
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("starts the selected launchable profile version", async () => {
    const requestedVersions: number[] = [];

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/profiles/launchable") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            items: [
              {
                id: "sbp_profile_alpha",
                displayName: "Alpha Profile",
                status: "active",
                latestVersion: 2,
                createdAt: "2026-03-01T00:00:00.000Z",
                updatedAt: "2026-03-05T00:00:00.000Z",
              },
            ],
          }),
        );
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/v1/sandbox/profiles/sbp_profile_alpha/versions/2/instances"
      ) {
        requestedVersions.push(2);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            status: "accepted",
            workflowRunId: "wfr_123",
            sandboxInstanceId: "sbi_started",
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

      if (request.method === "GET" && requestUrl.pathname === "/v1/sandbox/instances/sbi_started") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "sbi_started",
            status: "starting",
            failureCode: null,
            failureMessage: null,
            automationConversation: null,
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
      resetControlPlaneApiClientForTest();

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });
      seedAuthenticatedSession(queryClient);

      const rendered = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <SessionsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      try {
        const profileSelect = await screen.findByRole("combobox", { name: "Sandbox profile" });
        fireEvent.click(profileSelect);

        const listbox = await screen.findByRole("listbox");
        fireEvent.click(within(listbox).getByRole("option", { name: "Alpha Profile" }));

        fireEvent.click(screen.getByRole("button", { name: "Start session" }));

        await waitFor(() => {
          expect(requestedVersions).toStrictEqual([2]);
        });
      } finally {
        rendered.unmount();
        await queryClient.cancelQueries();
        queryClient.clear();
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
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
