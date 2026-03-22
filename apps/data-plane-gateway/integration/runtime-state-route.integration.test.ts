/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import {
  connectBootstrapSocket,
  insertSandboxInstanceRow,
  mintValidBootstrapToken,
  RuntimeStateRouteTestTimeoutMs,
  waitForRuntimeState,
} from "./runtime-state-test-helpers.js";
import { it } from "./test-context.js";
import { closeWebSocket, waitForWebSocketClose } from "./websocket-test-helpers.js";

describe("runtime state route integration", () => {
  it(
    "returns owner and attachment state for an active bootstrap connection",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "runtime_state_route_it",
      });
      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });

      const snapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null && currentSnapshot.attachment !== null,
      });

      expect(snapshot.ownerLeaseId).not.toBeNull();
      expect(snapshot.attachment).not.toBeNull();
      expect(snapshot.attachment?.sandboxInstanceId).toBe(sandboxInstanceId);
      expect(snapshot.attachment?.ownerLeaseId).toBe(snapshot.ownerLeaseId);
      expect(snapshot.attachment?.nodeId).toMatch(/^dpg_/);
      expect(snapshot.attachment?.sessionId).toMatch(/^dts_/);

      await closeWebSocket(bootstrapSocket);

      const clearedSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId === null && currentSnapshot.attachment === null,
      });
      expect(clearedSnapshot).toEqual({
        ownerLeaseId: null,
        attachment: null,
      });
    },
    RuntimeStateRouteTestTimeoutMs,
  );

  it(
    "does not clear the active attachment when a replaced bootstrap socket closes",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "runtime_state_route_it",
      });

      const firstSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });
      const firstSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null && currentSnapshot.attachment !== null,
      });
      const firstOwnerLeaseId = firstSnapshot.ownerLeaseId;
      if (firstOwnerLeaseId === null) {
        throw new Error("Expected the first bootstrap connection to establish an owner lease.");
      }

      const firstSocketClosePromise = waitForWebSocketClose(firstSocket);
      const secondSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });

      const secondSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null &&
          currentSnapshot.ownerLeaseId !== firstOwnerLeaseId &&
          currentSnapshot.attachment !== null,
      });

      expect(secondSnapshot.ownerLeaseId).not.toBe(firstOwnerLeaseId);
      expect(secondSnapshot.attachment?.ownerLeaseId).toBe(secondSnapshot.ownerLeaseId);

      const firstSocketClose = await firstSocketClosePromise;
      expect(firstSocketClose.code).toBe(1012);

      const postStaleCloseSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId === secondSnapshot.ownerLeaseId &&
          currentSnapshot.attachment?.ownerLeaseId === secondSnapshot.ownerLeaseId,
      });

      expect(postStaleCloseSnapshot.ownerLeaseId).toBe(secondSnapshot.ownerLeaseId);
      expect(postStaleCloseSnapshot.attachment?.ownerLeaseId).toBe(secondSnapshot.ownerLeaseId);

      await closeWebSocket(secondSocket);
    },
    RuntimeStateRouteTestTimeoutMs,
  );

  it(
    "closes an unresponsive bootstrap websocket and clears runtime attachment state",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "runtime_state_route_it",
      });
      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
        autoPong: false,
      });

      const closeEvent = await waitForWebSocketClose(bootstrapSocket);
      expect(closeEvent.code).toBe(1011);

      const clearedSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId === null && currentSnapshot.attachment === null,
      });

      expect(clearedSnapshot).toEqual({
        ownerLeaseId: null,
        attachment: null,
      });
    },
    RuntimeStateRouteTestTimeoutMs,
  );
});
