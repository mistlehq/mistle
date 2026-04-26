/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { systemClock } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import {
  createAttachmentBackedActiveBootstrapSessionStore,
  type ActiveBootstrapSessionStore,
} from "../src/runtime-state/active-bootstrap-session-store.js";
import { ValkeySandboxRuntimeAttachmentStore } from "../src/runtime-state/adapters/valkey-sandbox-runtime-attachment-store.js";
import {
  closeValkeyClient,
  createValkeyClient,
  type ValkeyClient,
} from "../src/runtime-state/valkey-client.js";
import { SandboxTunnelWebSocketAdmission } from "../src/tunnel/admission/sandbox-tunnel-websocket-admission.js";
import { ValkeySandboxOwnerStore } from "../src/tunnel/ownership/adapters/valkey-sandbox-owner-store.js";
import { AttachmentBackedSandboxOwnerResolver } from "../src/tunnel/ownership/attachment-backed-sandbox-owner-resolver.js";
import { insertSandboxInstanceRow, mintValidBootstrapToken } from "./runtime-state-test-helpers.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";

function createValkeyRuntimeStateFixture(input: { fixture: DataPlaneGatewayIntegrationFixture }): {
  activeBootstrapSessionStore: ActiveBootstrapSessionStore;
  client: ValkeyClient;
  ownerStore: ValkeySandboxOwnerStore;
} {
  if (input.fixture.config.app.runtimeState.backend !== "valkey") {
    throw new Error(
      "Tunnel websocket admission integration tests require the valkey runtime-state backend.",
    );
  }

  const valkeyConfig = input.fixture.config.app.runtimeState.valkey;
  if (valkeyConfig === undefined) {
    throw new Error(
      "Expected runtime-state Valkey config for tunnel websocket admission integration tests.",
    );
  }

  const client = createValkeyClient({
    url: valkeyConfig.url,
  });
  const attachmentStore = new ValkeySandboxRuntimeAttachmentStore(client, valkeyConfig.keyPrefix);

  return {
    activeBootstrapSessionStore: createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
    client,
    ownerStore: new ValkeySandboxOwnerStore(client, valkeyConfig.keyPrefix),
  };
}

describe("sandbox tunnel websocket admission integration", () => {
  it("does not activate bootstrap ownership before the websocket attaches", async ({ fixture }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId: "sandbox_tunnel_websocket_admission_it",
    });

    const bootstrapToken = await mintValidBootstrapToken({
      fixture,
      sandboxInstanceId,
    });
    const requestUrl = new URL(
      `/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
      fixture.baseUrl,
    ).toString();

    const { activeBootstrapSessionStore, client, ownerStore } = createValkeyRuntimeStateFixture({
      fixture,
    });
    await client.connect();

    try {
      const admission = new SandboxTunnelWebSocketAdmission({
        bootstrapTokenConfig: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        connectionTokenConfig: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        sandboxOwnerResolver: new AttachmentBackedSandboxOwnerResolver(
          "dpg_test_admission",
          activeBootstrapSessionStore,
          systemClock,
        ),
      });

      const result = await admission.admitRequest({
        db: fixture.db,
        requestUrl,
        requestedInstanceId: sandboxInstanceId,
      });

      expect(result).toEqual({
        kind: "admitted",
        request: expect.objectContaining({
          kind: "bootstrap",
          relaySessionId: expect.stringMatching(/^dts_/),
          sandboxInstanceId,
          ownerLeaseId: expect.any(String),
        }),
      });

      const activeOwner = await ownerStore.getOwner({
        sandboxInstanceId,
      });
      expect(activeOwner).toBeUndefined();
    } finally {
      await closeValkeyClient(client);
    }
  });
});
