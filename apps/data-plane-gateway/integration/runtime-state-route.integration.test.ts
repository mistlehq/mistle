/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import { createValkeyClient, closeValkeyClient } from "../src/runtime-state/valkey-client.js";
import { ValkeySandboxOwnerStore } from "../src/tunnel/ownership/adapters/valkey-sandbox-owner-store.js";
import {
  connectBootstrapSocket,
  insertSandboxInstanceRow,
  mintValidBootstrapToken,
  RuntimeStateRouteTestTimeoutMs,
  waitForRuntimeState,
} from "./runtime-state-test-helpers.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import { closeWebSocket, waitForWebSocketClose } from "./websocket-test-helpers.js";

const BootstrapHealthObservationWindowMs = 12_000;
const UnresponsiveBootstrapCloseTimeoutMs = 80_000;

function createOwnerStoreFixture(input: { fixture: DataPlaneGatewayIntegrationFixture }): {
  client: ReturnType<typeof createValkeyClient>;
  store: ValkeySandboxOwnerStore;
} {
  if (input.fixture.config.app.runtimeState.backend !== "valkey") {
    throw new Error(
      "Runtime-state route integration tests require the valkey runtime-state backend.",
    );
  }

  const valkeyConfig = input.fixture.config.app.runtimeState.valkey;
  if (valkeyConfig === undefined) {
    throw new Error(
      "Expected runtime-state Valkey config for runtime-state route integration tests.",
    );
  }

  const client = createValkeyClient({
    url: valkeyConfig.url,
  });

  return {
    client,
    store: new ValkeySandboxOwnerStore(client, valkeyConfig.keyPrefix),
  };
}

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
        presence: {
          activeCount: 0,
        },
        keepalive: {
          active: false,
        },
        runtime: {
          ready: false,
        },
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
    "does not expose a replacement owner lease before the replacement bootstrap attaches",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "runtime_state_route_owner_split_brain_it",
      });

      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });

      const initialSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null && currentSnapshot.attachment !== null,
      });
      const initialOwnerLeaseId = initialSnapshot.ownerLeaseId;
      if (initialOwnerLeaseId === null) {
        throw new Error("Expected the bootstrap connection to establish an owner lease.");
      }

      const { client, store } = createOwnerStoreFixture({
        fixture,
      });
      await client.connect();

      try {
        const replacementOwner = await store.claimOwner({
          sandboxInstanceId,
          nodeId: "dpg_replacement",
          sessionId: "dts_replacement",
          ttlMs: 30_000,
        });

        const coherentSnapshot = await waitForRuntimeState({
          fixture,
          sandboxInstanceId,
          predicate: (currentSnapshot) =>
            currentSnapshot.ownerLeaseId === initialOwnerLeaseId &&
            currentSnapshot.attachment?.ownerLeaseId === initialOwnerLeaseId,
        });

        expect(replacementOwner.leaseId).not.toBe(initialOwnerLeaseId);
        expect(coherentSnapshot.ownerLeaseId).toBe(initialOwnerLeaseId);
        expect(coherentSnapshot.attachment?.ownerLeaseId).toBe(initialOwnerLeaseId);
      } finally {
        await closeValkeyClient(client);
        await closeWebSocket(bootstrapSocket);
      }
    },
    RuntimeStateRouteTestTimeoutMs,
  );

  it(
    "does not expose replaced bootstrap keepalive state after a replacement bootstrap attaches",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "runtime_state_route_keepalive_owner_fence_it",
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

      firstSocket.send(
        JSON.stringify({
          type: "keepalive.state",
          ttlMs: 30_000,
          active: true,
        }),
      );

      const activeKeepaliveSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId === firstOwnerLeaseId &&
          currentSnapshot.attachment?.ownerLeaseId === firstOwnerLeaseId &&
          currentSnapshot.keepalive.active,
      });
      expect(activeKeepaliveSnapshot.keepalive.active).toBe(true);

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
          currentSnapshot.attachment?.ownerLeaseId === currentSnapshot.ownerLeaseId &&
          currentSnapshot.keepalive.active === false,
      });

      expect(secondSnapshot.ownerLeaseId).not.toBe(firstOwnerLeaseId);
      expect(secondSnapshot.keepalive.active).toBe(false);

      await expect(firstSocketClosePromise).resolves.toEqual({
        code: 1012,
        reason: "Replaced by newer sandbox tunnel connection.",
      });
      await closeWebSocket(secondSocket);
    },
    RuntimeStateRouteTestTimeoutMs,
  );

  it(
    "keeps the active bootstrap attached when a replacement owner lease is claimed before replacement attach",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "runtime_state_route_owner_heartbeat_it",
      });

      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });

      const initialSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null && currentSnapshot.attachment !== null,
      });
      const initialOwnerLeaseId = initialSnapshot.ownerLeaseId;
      if (initialOwnerLeaseId === null) {
        throw new Error("Expected the bootstrap connection to establish an owner lease.");
      }

      const { client, store } = createOwnerStoreFixture({
        fixture,
      });
      await client.connect();

      try {
        await store.claimOwner({
          sandboxInstanceId,
          nodeId: "dpg_replacement",
          sessionId: "dts_replacement",
          ttlMs: 30_000,
        });

        const closePromise = waitForWebSocketClose(bootstrapSocket);
        await systemSleeper.sleep(12_000);

        const closeResult = await Promise.race([
          closePromise.then((event) => ({ kind: "closed" as const, event })),
          systemSleeper.sleep(50).then(() => ({ kind: "still-open" as const })),
        ]);
        expect(closeResult).toEqual({
          kind: "still-open",
        });

        const postClaimSnapshot = await waitForRuntimeState({
          fixture,
          sandboxInstanceId,
          predicate: (currentSnapshot) =>
            currentSnapshot.ownerLeaseId === initialOwnerLeaseId &&
            currentSnapshot.attachment?.ownerLeaseId === initialOwnerLeaseId,
        });

        expect(postClaimSnapshot.ownerLeaseId).toBe(initialOwnerLeaseId);
        expect(postClaimSnapshot.attachment?.ownerLeaseId).toBe(initialOwnerLeaseId);
      } finally {
        await closeValkeyClient(client);
        await closeWebSocket(bootstrapSocket);
      }
    },
    RuntimeStateRouteTestTimeoutMs,
  );

  it(
    "keeps a healthy bootstrap websocket attached across the first ping cycle",
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

      const initialSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null && currentSnapshot.attachment !== null,
      });
      const initialOwnerLeaseId = initialSnapshot.ownerLeaseId;
      if (initialOwnerLeaseId === null) {
        throw new Error("Expected the bootstrap connection to establish an owner lease.");
      }

      const closePromise = waitForWebSocketClose(bootstrapSocket);
      await systemSleeper.sleep(BootstrapHealthObservationWindowMs);

      const closeResult = await Promise.race([
        closePromise.then((event) => ({ kind: "closed" as const, event })),
        systemSleeper.sleep(50).then(() => ({ kind: "still-open" as const })),
      ]);
      expect(closeResult).toEqual({
        kind: "still-open",
      });

      const snapshotAfterObservation = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId === initialOwnerLeaseId &&
          currentSnapshot.attachment?.ownerLeaseId === initialOwnerLeaseId,
      });

      expect(snapshotAfterObservation.ownerLeaseId).toBe(initialOwnerLeaseId);
      expect(snapshotAfterObservation.attachment?.ownerLeaseId).toBe(initialOwnerLeaseId);

      await closeWebSocket(bootstrapSocket);
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
        presence: {
          activeCount: 0,
        },
        keepalive: {
          active: false,
        },
        runtime: {
          ready: false,
        },
      });
    },
    UnresponsiveBootstrapCloseTimeoutMs,
  );
});
