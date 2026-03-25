import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, type RenderResult } from "@testing-library/react";

import { resetDashboardConfigForTest } from "../../src/config.js";
import { resetControlPlaneApiClientForTest } from "../../src/lib/control-plane-api/client.js";
import { seedAuthenticatedSession } from "../../src/test-support/auth-session.js";
import { createTestQueryClient } from "../../src/test-support/query-client.js";

export type DashboardRequestHandler = (
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

function createDashboardQueryClient(): QueryClient {
  return createTestQueryClient();
}

export async function renderDashboardPageIntegration(input: {
  handler: DashboardRequestHandler;
  ui: React.JSX.Element;
}): Promise<{
  close: () => Promise<void>;
  queryClient: QueryClient;
  rendered: RenderResult;
}> {
  const server = await startDashboardServer({
    handler: input.handler,
  });

  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: server.baseUrl,
  });
  resetDashboardConfigForTest();
  resetControlPlaneApiClientForTest();

  const queryClient = createDashboardQueryClient();
  seedAuthenticatedSession(queryClient);

  const rendered = render(
    <QueryClientProvider client={queryClient}>{input.ui}</QueryClientProvider>,
  );

  return {
    close: async () => {
      rendered.unmount();
      await queryClient.cancelQueries();
      queryClient.clear();
      cleanup();
      resetDashboardConfigForTest();
      resetControlPlaneApiClientForTest();
      await server.close();
    },
    queryClient,
    rendered,
  };
}
