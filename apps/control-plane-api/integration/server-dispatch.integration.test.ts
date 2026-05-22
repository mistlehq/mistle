import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it } from "vitest";

import { startServer } from "../src/server.js";
import type { AppContextBindings, StartedServer } from "../src/types.js";

const Host = "127.0.0.1";

let startedServer: StartedServer | undefined;

afterEach(async () => {
  if (startedServer !== undefined) {
    await startedServer.close();
    startedServer = undefined;
  }
});

describe("startServer", () => {
  it("dispatches matching Node requests before falling through to the Hono app", async () => {
    const app = new OpenAPIHono<AppContextBindings>();
    app.get("/hono", (ctx) => ctx.text("handled by hono"));

    startedServer = startServer({
      app,
      host: Host,
      port: 0,
      nodeRequestHandlers: [
        {
          matches: (request) => request.url === "/node",
          handle: (_request, response) => {
            response.statusCode = 200;
            response.end("handled by node");
          },
        },
      ],
    });
    await once(startedServer.server, "listening");
    const address = startedServer.server.address();
    if (!isAddressInfo(address)) {
      throw new Error("Expected control plane API test server to bind to a TCP address.");
    }

    const nodeResponse = await fetch(`http://${Host}:${String(address.port)}/node`);
    const honoResponse = await fetch(`http://${Host}:${String(address.port)}/hono`);

    expect(await nodeResponse.text()).toBe("handled by node");
    expect(await honoResponse.text()).toBe("handled by hono");
  });

  it("returns an internal server error when Node request dispatch fails before headers are sent", async () => {
    const app = new OpenAPIHono<AppContextBindings>();
    app.get("/hono", (ctx) => ctx.text("handled by hono"));

    startedServer = startServer({
      app,
      host: Host,
      port: 0,
      nodeRequestHandlers: [
        {
          matches: (request) => request.url === "/node",
          handle: () => {
            throw new Error("node dispatch failed");
          },
        },
      ],
    });
    await once(startedServer.server, "listening");
    const address = startedServer.server.address();
    if (!isAddressInfo(address)) {
      throw new Error("Expected control plane API test server to bind to a TCP address.");
    }

    const nodeResponse = await fetch(`http://${Host}:${String(address.port)}/node`);

    expect(nodeResponse.status).toBe(500);
    expect(await nodeResponse.text()).toBe("Internal Server Error");
  });
});

function isAddressInfo(address: AddressInfo | string | null): address is AddressInfo {
  return typeof address === "object" && address !== null;
}
