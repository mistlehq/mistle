import {
  PayloadKindRawBytes,
  PayloadKindWebSocketText,
  encodeDataFrame,
} from "@mistle/sandbox-session-protocol";
import { systemClock } from "@mistle/time";
import { describe, expect, it } from "vitest";

import { LocalGatewayForwardingClientAdapter } from "../gateway-forwarding/adapters/local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "../gateway-forwarding/adapters/local-gateway-forwarding-server-adapter.js";
import { InteractiveStreamRouter } from "../gateway-forwarding/interactive-stream-router.js";
import { InMemorySandboxOwnerStore } from "../ownership/adapters/in-memory-sandbox-owner-store.js";
import { StoreBackedSandboxOwnerResolver } from "../ownership/store-backed-sandbox-owner-resolver.js";
import { InMemoryTunnelSessionRegistryAdapter } from "../tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../tunnel-session/index.js";
import {
  TunnelProtocolTranslator,
  TunnelProtocolViolationError,
} from "./tunnel-protocol-translator.js";

const LocalNodeId = "dpg_test";
const SandboxInstanceId = "sbi_test";
const BootstrapSessionId = "sess_bootstrap";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function createTranslatorHarness() {
  const ownerStore = new InMemorySandboxOwnerStore(systemClock);
  await ownerStore.claimOwner({
    sandboxInstanceId: SandboxInstanceId,
    nodeId: LocalNodeId,
    sessionId: BootstrapSessionId,
    ttlMs: 60_000,
  });

  const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
  registry.attachBootstrapSession({
    sandboxInstanceId: SandboxInstanceId,
    side: "bootstrap",
    nodeId: LocalNodeId,
    sessionId: BootstrapSessionId,
  });

  const forwardingServer = new LocalGatewayForwardingServerAdapter(registry);
  const forwardingClient = new LocalGatewayForwardingClientAdapter(LocalNodeId, forwardingServer);
  const router = new InteractiveStreamRouter(
    LocalNodeId,
    new StoreBackedSandboxOwnerResolver(LocalNodeId, ownerStore),
    forwardingClient,
  );

  return {
    router,
    translator: new TunnelProtocolTranslator(router),
  };
}

describe("TunnelProtocolTranslator", () => {
  it("maps a connection stream.open to the bootstrap stream id", async () => {
    const { translator } = await createTranslatorHarness();

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: JSON.stringify({
          type: "stream.open",
          streamId: 41,
          channel: {
            kind: "pty",
            session: "create",
            cols: 80,
            rows: 24,
          },
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "connection",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "forward",
        payload: JSON.stringify({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "pty",
            session: "create",
            cols: 80,
            rows: 24,
          },
        }),
      },
    });
  });

  it("maps a connection fileUpload stream.open to the bootstrap stream id", async () => {
    const { translator } = await createTranslatorHarness();

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: JSON.stringify({
          type: "stream.open",
          streamId: 42,
          channel: {
            kind: "fileUpload",
            threadId: "thread_123",
            mimeType: "image/png",
            originalFilename: "screenshot.png",
            sizeBytes: 128,
          },
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "connection",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "forward",
        payload: JSON.stringify({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "fileUpload",
            threadId: "thread_123",
            mimeType: "image/png",
            originalFilename: "screenshot.png",
            sizeBytes: 128,
          },
        }),
      },
    });
  });

  it("drops late bootstrap pty.exit events after the binding is gone", async () => {
    const { router, translator } = await createTranslatorHarness();

    await translator.translateInboundMessage({
      clientSessionId: "conn_1",
      payload: JSON.stringify({
        type: "stream.open",
        streamId: 41,
        channel: {
          kind: "pty",
          session: "create",
          cols: 80,
          rows: 24,
        },
      }),
      sandboxInstanceId: SandboxInstanceId,
      sourcePeerSide: "connection",
    });

    const closeTranslation = await translator.translateInboundMessage({
      clientSessionId: "conn_1",
      payload: JSON.stringify({
        type: "stream.close",
        streamId: 41,
      }),
      sandboxInstanceId: SandboxInstanceId,
      sourcePeerSide: "connection",
    });
    if (closeTranslation.releaseInteractiveStream === undefined) {
      throw new Error("Expected stream.close translation to request release of the binding.");
    }
    await router.closeInteractiveStream({
      sandboxInstanceId: SandboxInstanceId,
      clientSessionId: closeTranslation.releaseInteractiveStream.clientSessionId,
      clientStreamId: closeTranslation.releaseInteractiveStream.clientStreamId,
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: BootstrapSessionId,
        payload: JSON.stringify({
          type: "stream.event",
          streamId: 1,
          event: {
            type: "pty.exit",
            exitCode: 0,
          },
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "bootstrap",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "drop",
      },
    });
  });

  it("keeps fileUpload bindings alive after client stream.close until completion arrives", async () => {
    const { translator } = await createTranslatorHarness();

    await translator.translateInboundMessage({
      clientSessionId: "conn_1",
      payload: JSON.stringify({
        type: "stream.open",
        streamId: 42,
        channel: {
          kind: "fileUpload",
          threadId: "thread_123",
          mimeType: "image/png",
          originalFilename: "upload.png",
          sizeBytes: 3,
        },
      }),
      sandboxInstanceId: SandboxInstanceId,
      sourcePeerSide: "connection",
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: JSON.stringify({
          type: "stream.close",
          streamId: 42,
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "connection",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "forward",
        payload: JSON.stringify({
          type: "stream.close",
          streamId: 1,
        }),
      },
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: BootstrapSessionId,
        payload: JSON.stringify({
          type: "stream.event",
          streamId: 1,
          event: {
            type: "fileUpload.completed",
            attachmentId: "att_123",
            threadId: "thread_123",
            originalFilename: "upload.png",
            mimeType: "image/png",
            sizeBytes: 3,
            path: "/tmp/attachments/thread_123/upload.png",
          },
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "bootstrap",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "forward",
        payload: JSON.stringify({
          type: "stream.event",
          streamId: 42,
          event: {
            type: "fileUpload.completed",
            attachmentId: "att_123",
            threadId: "thread_123",
            originalFilename: "upload.png",
            mimeType: "image/png",
            sizeBytes: 3,
            path: "/tmp/attachments/thread_123/upload.png",
          },
        }),
        targetConnectionSessionId: "conn_1",
      },
      releaseInteractiveStream: {
        clientSessionId: "conn_1",
        clientStreamId: 42,
      },
    });
  });

  it("keeps bootstrap lease control messages local to the gateway", async () => {
    const { translator } = await createTranslatorHarness();

    await expect(
      translator.translateInboundMessage({
        clientSessionId: BootstrapSessionId,
        payload: JSON.stringify({
          type: "lease.create",
          lease: {
            id: "sxl_test",
            kind: "agent_execution",
            source: "codex",
            externalExecutionId: "turn_123",
            metadata: {
              threadId: "thr_123",
            },
          },
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "bootstrap",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "drop",
      },
      executionLeaseControlMessage: {
        type: "lease.create",
        lease: {
          id: "sxl_test",
          kind: "agent_execution",
          source: "codex",
          externalExecutionId: "turn_123",
          metadata: {
            threadId: "thr_123",
          },
        },
      },
    });
  });

  it("responds with a reset and releases the binding when connection binary data is invalid for the channel", async () => {
    const { router, translator } = await createTranslatorHarness();

    await router.openInteractiveStream({
      sandboxInstanceId: SandboxInstanceId,
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 41,
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: toArrayBuffer(
          encodeDataFrame({
            streamId: 41,
            payloadKind: PayloadKindWebSocketText,
            payload: new TextEncoder().encode("invalid-pty-data"),
          }),
        ),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "connection",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "respond",
        payload: JSON.stringify({
          type: "stream.reset",
          streamId: 41,
          code: "invalid_stream_data",
          message: "PTY streams only accept raw-bytes data frames.",
        }),
      },
      notifyBootstrapPeerOfReleasedStream: {
        channelKind: "pty",
        clientSessionId: "conn_1",
        clientStreamId: 41,
        tunnelStreamId: 1,
      },
      releaseInteractiveStream: {
        clientSessionId: "conn_1",
        clientStreamId: 41,
      },
    });
  });

  it("responds with a reset and releases the binding when fileUpload data is not raw bytes", async () => {
    const { router, translator } = await createTranslatorHarness();

    await router.openInteractiveStream({
      sandboxInstanceId: SandboxInstanceId,
      channelKind: "fileUpload",
      clientSessionId: "conn_1",
      clientStreamId: 42,
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: toArrayBuffer(
          encodeDataFrame({
            streamId: 42,
            payloadKind: PayloadKindWebSocketText,
            payload: new TextEncoder().encode("invalid-upload-data"),
          }),
        ),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "connection",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "respond",
        payload: JSON.stringify({
          type: "stream.reset",
          streamId: 42,
          code: "invalid_stream_data",
          message: "File upload streams only accept raw-bytes data frames.",
        }),
      },
      notifyBootstrapPeerOfReleasedStream: {
        channelKind: "fileUpload",
        clientSessionId: "conn_1",
        clientStreamId: 42,
        tunnelStreamId: 1,
      },
      releaseInteractiveStream: {
        clientSessionId: "conn_1",
        clientStreamId: 42,
      },
    });
  });

  it("rewrites bootstrap binary frames back to the client stream id", async () => {
    const { router, translator } = await createTranslatorHarness();

    await router.openInteractiveStream({
      sandboxInstanceId: SandboxInstanceId,
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 41,
    });

    const translated = await translator.translateInboundMessage({
      clientSessionId: BootstrapSessionId,
      payload: toArrayBuffer(
        encodeDataFrame({
          streamId: 1,
          payloadKind: PayloadKindRawBytes,
          payload: new Uint8Array([1, 2, 3]),
        }),
      ),
      sandboxInstanceId: SandboxInstanceId,
      sourcePeerSide: "bootstrap",
    });

    expect(translated).toEqual({
      delivery: {
        kind: "forward",
        payload: expect.any(ArrayBuffer),
        targetConnectionSessionId: "conn_1",
      },
    });
    if (translated.delivery.kind !== "forward" || typeof translated.delivery.payload === "string") {
      throw new Error("Expected bootstrap binary payload translation to forward an ArrayBuffer.");
    }
    const header = new DataView(translated.delivery.payload);
    expect(header.getUint32(1)).toBe(41);
  });

  it("rejects malformed connection binary payloads as protocol violations", async () => {
    const { translator } = await createTranslatorHarness();

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: new Uint8Array([1, 2, 3]).buffer,
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "connection",
      }),
    ).rejects.toThrow(TunnelProtocolViolationError);
  });
});
