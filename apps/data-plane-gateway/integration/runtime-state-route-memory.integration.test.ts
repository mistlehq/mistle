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
  readRuntimeState,
  waitForRuntimeState,
} from "./runtime-state-test-helpers.js";
import { itMemory } from "./test-context.js";
import { closeWebSocket, waitForWebSocketClose } from "./websocket-test-helpers.js";

describe("runtime state route integration (memory backend)", () => {
  itMemory(
    "returns owner and attachment state for an active bootstrap connection",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "runtime_state_route_memory_it",
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

  itMemory(
    "does not clear the active attachment when a replaced bootstrap socket closes",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "runtime_state_route_memory_it",
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
          currentSnapshot.attachment !== null &&
          currentSnapshot.attachment.ownerLeaseId === currentSnapshot.ownerLeaseId,
      });

      await firstSocketClosePromise;

      const postCloseSnapshot = await readRuntimeState({
        fixture,
        sandboxInstanceId,
      });
      expect(postCloseSnapshot).toEqual(secondSnapshot);

      await closeWebSocket(secondSocket);
    },
    RuntimeStateRouteTestTimeoutMs,
  );
});
