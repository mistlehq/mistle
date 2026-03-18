import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createRouter } from "./router.js";

const Servers = new Set<ReturnType<typeof createServer>>();

async function startServer(server: ReturnType<typeof createServer>): Promise<string> {
  Servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected tcp address");
  }

  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  for (const server of Servers) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  Servers.clear();
});

describe("createRouter", () => {
  it("returns healthy payload when startup is ready", async () => {
    const baseUrl = await startServer(
      createServer(
        createRouter({
          state: {
            startupReady: true,
          },
        }),
      ),
    );

    const response = await fetch(`${baseUrl}/__healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.text()).resolves.toBe(`{"ok":true}`);
  });

  it("returns not found for unknown paths", async () => {
    const baseUrl = await startServer(
      createServer(
        createRouter({
          state: {
            startupReady: true,
          },
        }),
      ),
    );

    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(404);
  });

  it("returns unhealthy payload when startup is not ready", async () => {
    const baseUrl = await startServer(
      createServer(
        createRouter({
          state: {
            startupReady: false,
          },
        }),
      ),
    );

    const response = await fetch(`${baseUrl}/__healthz`);

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.text()).resolves.toBe(`{"ok":false}`);
  });

  it("delegates unmatched requests to the proxy handler", async () => {
    let forwardedMethod = "";
    let forwardedUrl = "";

    const baseUrl = await startServer(
      createServer(
        createRouter({
          state: {
            startupReady: true,
          },
          proxyHandler: (request, response) => {
            forwardedMethod = request.method ?? "";
            forwardedUrl = request.url ?? "";
            response.statusCode = 202;
            response.end(`{"proxied":true}`);
          },
        }),
      ),
    );

    const response = await fetch(`${baseUrl}/`);

    expect(forwardedMethod).toBe("GET");
    expect(forwardedUrl).toBe("/");
    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe(`{"proxied":true}`);
  });
});
