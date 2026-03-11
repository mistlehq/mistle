/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { describe, expect } from "vitest";

import { createInternalForwardingHeaders } from "../src/owner-forwarding/internal-forwarding-auth.js";
import { it } from "./test-context.js";
import {
  connectWebSocket,
  connectWebSocketExpectFailure,
  waitForWebSocketClose,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 30_000;

describe("internal gateway forwarding integration", () => {
  it(
    "rejects unauthenticated internal HTTP forwarding requests",
    async ({ fixture }) => {
      const response = await fetch(`${fixture.baseUrl}/__internal/forward/http/preview/demo`, {
        method: "GET",
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Internal gateway forwarding is unauthorized.",
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "returns not implemented for authenticated internal HTTP forwarding requests",
    async ({ fixture }) => {
      const response = await fetch(`${fixture.baseUrl}/__internal/forward/http/preview/demo`, {
        method: "GET",
        headers: createInternalForwardingHeaders({
          serviceToken: fixture.config.internalAuth.serviceToken,
          identity: {
            sourceNodeId: "dpg_source",
            targetNodeId: "dpg_target",
          },
        }),
      });

      expect(response.status).toBe(501);
      await expect(response.json()).resolves.toEqual({
        error: "Internal gateway forwarding is not enabled.",
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects unauthenticated internal websocket forwarding requests",
    async ({ fixture }) => {
      const failedConnect = await connectWebSocketExpectFailure(
        `${fixture.websocketBaseUrl}/__internal/forward/tunnel/sandbox/sbi_test`,
      );

      expect(failedConnect.error).toBeInstanceOf(Error);
      expect(failedConnect.responseStatusCode).toBe(401);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "closes authenticated internal websocket forwarding requests with not implemented status",
    async ({ fixture }) => {
      const socket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/__internal/forward/tunnel/sandbox/sbi_test`,
        {
          headers: Object.fromEntries(
            createInternalForwardingHeaders({
              serviceToken: fixture.config.internalAuth.serviceToken,
              identity: {
                sourceNodeId: "dpg_source",
                targetNodeId: "dpg_target",
              },
            }).entries(),
          ),
        },
      );

      const closed = await waitForWebSocketClose(socket);

      expect(closed.code).toBe(1013);
      expect(closed.reason).toBe("Internal gateway forwarding is not enabled.");
    },
    IntegrationTestTimeoutMs,
  );
});
