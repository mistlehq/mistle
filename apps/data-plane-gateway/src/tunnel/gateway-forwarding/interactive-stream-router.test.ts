import { systemClock } from "@mistle/time";
import { describe, expect, it } from "vitest";

import { createAttachmentBackedActiveBootstrapSessionStore } from "../../runtime-state/active-bootstrap-session-store.js";
import { InMemorySandboxRuntimeAttachmentStore } from "../../runtime-state/adapters/in-memory-sandbox-runtime-attachment-store.js";
import { AttachmentBackedSandboxOwnerResolver } from "../ownership/attachment-backed-sandbox-owner-resolver.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../tunnel-session/index.js";
import { LocalGatewayForwardingClientAdapter } from "./adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "./adapters/local-gateway-forwarding-server-adapter.js";
import { InteractiveStreamRouter } from "./interactive-stream-router.js";

describe("InteractiveStreamRouter", () => {
  it("routes interactive stream operations to the resolved owner node", async () => {
    const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(systemClock);
    await attachmentStore.upsertAttachment({
      sandboxInstanceId: "sbi_test",
      ownerLeaseId: "dtl_attached",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
      attachedAtMs: systemClock.nowMs(),
      ttlMs: 60_000,
      nowMs: systemClock.nowMs(),
    });

    const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
    registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });
    const forwardingClient = new LocalGatewayForwardingClientAdapter(
      "dpg_test",
      new LocalGatewayForwardingServerAdapter(registry),
    );
    const router = new InteractiveStreamRouter(
      "dpg_test",
      new AttachmentBackedSandboxOwnerResolver(
        "dpg_test",
        createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
        systemClock,
      ),
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

  it("does not route an open stream to a different local bootstrap session than the active attachment", async () => {
    const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(systemClock);
    await attachmentStore.upsertAttachment({
      sandboxInstanceId: "sbi_test",
      ownerLeaseId: "dtl_attached",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_a",
      attachedAtMs: systemClock.nowMs(),
      ttlMs: 60_000,
      nowMs: systemClock.nowMs(),
    });

    const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
    registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_b",
    });
    const forwardingClient = new LocalGatewayForwardingClientAdapter(
      "dpg_test",
      new LocalGatewayForwardingServerAdapter(registry),
    );
    const router = new InteractiveStreamRouter(
      "dpg_test",
      new AttachmentBackedSandboxOwnerResolver(
        "dpg_test",
        createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
        systemClock,
      ),
      forwardingClient,
    );

    await expect(
      router.openInteractiveStream({
        sandboxInstanceId: "sbi_test",
        channelKind: "agent",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).rejects.toThrow("Resolved bootstrap session is no longer current");
  });

  it("routes using the active attached bootstrap session even when a separate owner lease was replaced", async () => {
    const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(systemClock);
    await attachmentStore.upsertAttachment({
      sandboxInstanceId: "sbi_test",
      ownerLeaseId: "dtl_attached",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
      attachedAtMs: systemClock.nowMs(),
      ttlMs: 60_000,
      nowMs: systemClock.nowMs(),
    });

    const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
    registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });
    const forwardingClient = new LocalGatewayForwardingClientAdapter(
      "dpg_test",
      new LocalGatewayForwardingServerAdapter(registry),
    );
    const router = new InteractiveStreamRouter(
      "dpg_test",
      new AttachmentBackedSandboxOwnerResolver(
        "dpg_test",
        createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
        systemClock,
      ),
      forwardingClient,
    );

    await expect(
      router.openInteractiveStream({
        sandboxInstanceId: "sbi_test",
        channelKind: "agent",
        clientSessionId: "conn_1",
        clientStreamId: 8,
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
        clientStreamId: 8,
        tunnelStreamId: 1,
      },
    });
  });

  it("fails fast when no owner is registered for the sandbox", async () => {
    const forwardingClient = new LocalGatewayForwardingClientAdapter(
      "dpg_test",
      new LocalGatewayForwardingServerAdapter(
        new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter()),
      ),
    );
    const router = new InteractiveStreamRouter(
      "dpg_test",
      new AttachmentBackedSandboxOwnerResolver(
        "dpg_test",
        createAttachmentBackedActiveBootstrapSessionStore(
          new InMemorySandboxRuntimeAttachmentStore(systemClock),
        ),
        systemClock,
      ),
      forwardingClient,
    );

    await expect(
      router.openInteractiveStream({
        sandboxInstanceId: "sbi_missing",
        channelKind: "agent",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).rejects.toThrow("Sandbox bootstrap tunnel is not connected");
  });

  it("treats release of an ownerless sandbox as a no-op", async () => {
    const forwardingClient = new LocalGatewayForwardingClientAdapter(
      "dpg_test",
      new LocalGatewayForwardingServerAdapter(
        new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter()),
      ),
    );
    const router = new InteractiveStreamRouter(
      "dpg_test",
      new AttachmentBackedSandboxOwnerResolver(
        "dpg_test",
        createAttachmentBackedActiveBootstrapSessionStore(
          new InMemorySandboxRuntimeAttachmentStore(systemClock),
        ),
        systemClock,
      ),
      forwardingClient,
    );

    await expect(
      router.releaseClientSessionStreams({
        sandboxInstanceId: "sbi_missing",
        clientSessionId: "conn_1",
      }),
    ).resolves.toEqual({
      bootstrapTarget: undefined,
      releasedBindings: [],
    });
  });

  it("does not release connection streams from a different local bootstrap session than the active attachment", async () => {
    const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(systemClock);
    await attachmentStore.upsertAttachment({
      sandboxInstanceId: "sbi_test",
      ownerLeaseId: "dtl_attached",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_a",
      attachedAtMs: systemClock.nowMs(),
      ttlMs: 60_000,
      nowMs: systemClock.nowMs(),
    });

    const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
    registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_b",
    });
    registry.bindClientStream({
      sandboxInstanceId: "sbi_test",
      channelKind: "agent",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });
    const forwardingClient = new LocalGatewayForwardingClientAdapter(
      "dpg_test",
      new LocalGatewayForwardingServerAdapter(registry),
    );
    const router = new InteractiveStreamRouter(
      "dpg_test",
      new AttachmentBackedSandboxOwnerResolver(
        "dpg_test",
        createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
        systemClock,
      ),
      forwardingClient,
    );

    await expect(
      router.releaseClientSessionStreams({
        sandboxInstanceId: "sbi_test",
        clientSessionId: "conn_1",
      }),
    ).resolves.toEqual({
      bootstrapTarget: undefined,
      releasedBindings: [],
    });
    expect(
      registry.getBindingByClientStream({
        sandboxInstanceId: "sbi_test",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).toEqual({
      channelKind: "agent",
      clientSessionId: "conn_1",
      clientStreamId: 7,
      tunnelStreamId: 1,
    });
  });
});
