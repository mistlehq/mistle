/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { systemClock } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import { ValkeySandboxRuntimeAttachmentStore } from "../src/runtime-state/adapters/valkey-sandbox-runtime-attachment-store.js";
import { closeValkeyClient, createValkeyClient } from "../src/runtime-state/valkey-client.js";
import { ValkeySandboxOwnerStore } from "../src/tunnel/ownership/adapters/valkey-sandbox-owner-store.js";
import {
  connectBootstrapSocket,
  insertSandboxInstanceRow,
  mintValidBootstrapToken,
  RuntimeStateRouteTestTimeoutMs,
  waitForRuntimeState,
} from "./runtime-state-test-helpers.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";

function createValkeyRuntimeStateStores(input: { fixture: DataPlaneGatewayIntegrationFixture }): {
  client: ReturnType<typeof createValkeyClient>;
  runtimeAttachmentStore: ValkeySandboxRuntimeAttachmentStore;
  ownerStore: ValkeySandboxOwnerStore;
} {
  if (input.fixture.config.app.runtimeState.backend !== "valkey") {
    throw new Error("Runtime shutdown integration tests require the valkey runtime-state backend.");
  }

  const valkeyConfig = input.fixture.config.app.runtimeState.valkey;
  if (valkeyConfig === undefined) {
    throw new Error("Expected runtime-state Valkey config for runtime shutdown integration tests.");
  }

  const client = createValkeyClient({
    url: valkeyConfig.url,
  });

  return {
    client,
    runtimeAttachmentStore: new ValkeySandboxRuntimeAttachmentStore(client, valkeyConfig.keyPrefix),
    ownerStore: new ValkeySandboxOwnerStore(client, valkeyConfig.keyPrefix),
  };
}

describe("data plane gateway runtime shutdown", () => {
  it(
    "drains bootstrap close cleanup before runtime shutdown closes runtime-state storage",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "runtime_shutdown_it",
      });
      await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });

      await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null && currentSnapshot.attachment !== null,
      });

      const { client, ownerStore, runtimeAttachmentStore } = createValkeyRuntimeStateStores({
        fixture,
      });
      await client.connect();

      try {
        await fixture.runtime.stop();

        await expect(
          ownerStore.getOwner({
            sandboxInstanceId,
          }),
        ).resolves.toBeUndefined();
        await expect(
          runtimeAttachmentStore.getAttachment({
            sandboxInstanceId,
            nowMs: systemClock.nowMs(),
          }),
        ).resolves.toBeNull();
      } finally {
        await closeValkeyClient(client);
      }
    },
    RuntimeStateRouteTestTimeoutMs,
  );
});
