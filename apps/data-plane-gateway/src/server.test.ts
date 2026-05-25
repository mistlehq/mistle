import { once } from "node:events";
import { request as sendHttpRequest } from "node:http";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { startServer } from "./server.js";
import type { AppContextBindings, StartedServer } from "./types.js";

function getServerBaseUrl(startedServer: StartedServer): URL {
  const address = startedServer.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected test server to listen on a TCP address.");
  }

  return new URL(`http://127.0.0.1:${address.port}`);
}

async function waitForServerListening(startedServer: StartedServer): Promise<void> {
  const address = startedServer.server.address();
  if (address !== null) {
    return;
  }

  await once(startedServer.server, "listening");
}

function startGatewayTestServer(app: Hono<AppContextBindings>): StartedServer {
  return startServer({
    app,
    host: "127.0.0.1",
    port: 0,
  });
}

describe("startServer", () => {
  it("closes without forcing connections when no request is active", async () => {
    const app = new Hono<AppContextBindings>();
    app.get("/healthz", (context) => context.text("ok"));

    const startedServer = startGatewayTestServer(app);
    await waitForServerListening(startedServer);

    await expect(startedServer.close({ forceAfterMs: 1 })).resolves.toEqual({
      forcedConnectionClose: false,
    });
  });

  it("force closes active HTTP connections when graceful close does not finish before the deadline", async () => {
    const app = new Hono<AppContextBindings>();
    let markRequestObserved = (): void => {
      throw new Error("Request observer was not initialized.");
    };
    const requestObserved = new Promise<void>((resolve) => {
      markRequestObserved = resolve;
    });
    const hangingResponse = new Promise<Response>(() => {});

    app.get("/hang", () => {
      markRequestObserved();
      return hangingResponse;
    });

    const startedServer = startGatewayTestServer(app);
    await waitForServerListening(startedServer);

    const requestUrl = getServerBaseUrl(startedServer);
    requestUrl.pathname = "/hang";
    const request = sendHttpRequest(requestUrl);
    request.on("error", () => {});
    request.end();
    await requestObserved;

    await expect(startedServer.close({ forceAfterMs: 1 })).resolves.toEqual({
      forcedConnectionClose: true,
    });
  });
});
