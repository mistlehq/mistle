import { systemClock } from "@mistle/time";
import { describe, expect, it } from "vitest";

import { InMemorySandboxOwnerStore } from "../ownership/adapters/in-memory-sandbox-owner-store.js";
import { StoreBackedSandboxOwnerResolver } from "../ownership/store-backed-sandbox-owner-resolver.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../tunnel-session/index.js";
import { LocalGatewayForwardingClientAdapter } from "./adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "./adapters/local-gateway-forwarding-server-adapter.js";
import { GatewayForwardingClient } from "./gateway-forwarding-client.js";
import { GatewayForwardingServer } from "./gateway-forwarding-server.js";
import { InteractiveStreamRouter } from "./interactive-stream-router.js";

describe("InteractiveStreamRouter", () => {
  it("routes interactive stream operations to the resolved owner node", async () => {
    const ownerStore = new InMemorySandboxOwnerStore(systemClock);
    await ownerStore.claimOwner({
      sandboxInstanceId: "sbi_test",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
      ttlMs: 60_000,
    });

    const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
    registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });
    const forwardingClient = new GatewayForwardingClient(
      new LocalGatewayForwardingClientAdapter(
        "dpg_test",
        new GatewayForwardingServer(new LocalGatewayForwardingServerAdapter(registry)),
      ),
    );
    const router = new InteractiveStreamRouter(
      "dpg_test",
      new StoreBackedSandboxOwnerResolver("dpg_test", ownerStore),
      forwardingClient,
    );

    await expect(
      router.openInteractiveStream({
        sandboxInstanceId: "sbi_test",
        channelKind: "agent",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).resolves.toEqual({
      bootstrapTarget: {
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap",
      },
      binding: {
        channelKind: "agent",
        clientSessionId: "conn_1",
        clientStreamId: 7,
        tunnelStreamId: 1,
      },
    });
  });

  it("fails fast when no owner is registered for the sandbox", async () => {
    const forwardingClient = new GatewayForwardingClient(
      new LocalGatewayForwardingClientAdapter(
        "dpg_test",
        new GatewayForwardingServer(
          new LocalGatewayForwardingServerAdapter(
            new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter()),
          ),
        ),
      ),
    );
    const router = new InteractiveStreamRouter(
      "dpg_test",
      new StoreBackedSandboxOwnerResolver("dpg_test", new InMemorySandboxOwnerStore(systemClock)),
      forwardingClient,
    );

    await expect(
      router.openInteractiveStream({
        sandboxInstanceId: "sbi_missing",
        channelKind: "pty",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).rejects.toThrow("does not have an active owner");
  });
});
