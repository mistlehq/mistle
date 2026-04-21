// @vitest-environment jsdom

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../../config.js";
import { resetAuthClientForTest } from "../../lib/auth/client.js";
import { createSandboxInstancePortAccess } from "./sessions-service.js";

type RequestRecord = {
  method: string;
  pathname: string;
};

async function startControlPlaneTestServer(input: {
  handler: (request: RequestRecord) => {
    status: number;
    body: unknown;
  };
}): Promise<{
  close: () => Promise<void>;
  origin: string;
  requests: RequestRecord[];
}> {
  const requests: RequestRecord[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const record: RequestRecord = {
      method: request.method ?? "GET",
      pathname: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
    };
    requests.push(record);

    const handled = input.handler(record);
    response.statusCode = handled.status;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(handled.body));
  });

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
    throw new Error("Expected a TCP server address.");
  }

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
  };
}

function setControlPlaneOrigin(origin: string): void {
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: origin,
  });
  resetDashboardConfigForTest();
  resetAuthClientForTest();
}

afterEach(() => {
  resetDashboardConfigForTest();
  resetAuthClientForTest();
});

describe("sessions service", () => {
  it("creates sandbox port access through the control plane route", async () => {
    const server = await startControlPlaneTestServer({
      handler: (request) => {
        if (
          request.method === "POST" &&
          request.pathname === "/v1/sandbox/instances/sbi_123/ports/5173/access"
        ) {
          return {
            status: 201,
            body: {
              bootstrapPath: "/_mistle/access/bootstrap",
              bootstrapUrl:
                "http://p-5173--sandbox.mistle.localhost:5202/_mistle/access/bootstrap?token=token_123",
              expiresAt: "2026-04-12T05:00:00Z",
              host: "p-5173--sandbox.mistle.localhost",
              token: "token_123",
            },
          };
        }

        throw new Error(`Unhandled request ${request.method} ${request.pathname}`);
      },
    });

    try {
      setControlPlaneOrigin(server.origin);

      await expect(
        createSandboxInstancePortAccess({
          instanceId: "sbi_123",
          port: 5173,
        }),
      ).resolves.toEqual({
        bootstrapPath: "/_mistle/access/bootstrap",
        bootstrapUrl:
          "http://p-5173--sandbox.mistle.localhost:5202/_mistle/access/bootstrap?token=token_123",
        expiresAt: "2026-04-12T05:00:00Z",
        host: "p-5173--sandbox.mistle.localhost",
        token: "token_123",
      });

      expect(server.requests).toEqual([
        {
          method: "POST",
          pathname: "/v1/sandbox/instances/sbi_123/ports/5173/access",
        },
      ]);
    } finally {
      await server.close();
    }
  });
});
