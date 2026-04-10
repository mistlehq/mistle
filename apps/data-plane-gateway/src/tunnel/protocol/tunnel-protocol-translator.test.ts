import {
  PayloadKindRawBytes,
  PayloadKindWebSocketBinary,
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

async function openFileUploadStream(translator: TunnelProtocolTranslator): Promise<void> {
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
}

async function openProcessesStream(translator: TunnelProtocolTranslator): Promise<void> {
  await translator.translateInboundMessage({
    clientSessionId: "conn_1",
    payload: JSON.stringify({
      type: "stream.open",
      streamId: 52,
      channel: {
        kind: "processes",
      },
    }),
    sandboxInstanceId: SandboxInstanceId,
    sourcePeerSide: "connection",
  });
}

async function sendBootstrapUploadCompleted(
  translator: TunnelProtocolTranslator,
): ReturnType<TunnelProtocolTranslator["translateInboundMessage"]> {
  return await translator.translateInboundMessage({
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
  });
}

async function sendBootstrapUploadReset(
  translator: TunnelProtocolTranslator,
): ReturnType<TunnelProtocolTranslator["translateInboundMessage"]> {
  return await translator.translateInboundMessage({
    clientSessionId: BootstrapSessionId,
    payload: JSON.stringify({
      type: "stream.reset",
      streamId: 1,
      code: "bootstrap_disconnected",
      message: "upload interrupted",
    }),
    sandboxInstanceId: SandboxInstanceId,
    sourcePeerSide: "bootstrap",
  });
}

async function sendBootstrapStreamComplete(
  translator: TunnelProtocolTranslator,
): ReturnType<TunnelProtocolTranslator["translateInboundMessage"]> {
  return await translator.translateInboundMessage({
    clientSessionId: BootstrapSessionId,
    payload: JSON.stringify({
      type: "stream.complete",
      streamId: 1,
    }),
    sandboxInstanceId: SandboxInstanceId,
    sourcePeerSide: "bootstrap",
  });
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
            ptySessionId: "terminal",
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
            ptySessionId: "terminal",
            cols: 80,
            rows: 24,
          },
        }),
      },
    });
  });

  it("allows multiple concurrent stream.open messages from the same client session", async () => {
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
            ptySessionId: "terminal",
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
            ptySessionId: "terminal",
            cols: 80,
            rows: 24,
          },
        }),
      },
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: JSON.stringify({
          type: "stream.open",
          streamId: 42,
          channel: {
            kind: "agent",
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
          streamId: 2,
          channel: {
            kind: "agent",
          },
        }),
      },
    });
  });

  it("maps a processes stream.open to the bootstrap stream id", async () => {
    const { translator } = await createTranslatorHarness();

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: JSON.stringify({
          type: "stream.open",
          streamId: 52,
          channel: {
            kind: "processes",
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
            kind: "processes",
          },
        }),
      },
    });
  });

  it("rejects duplicate client stream bindings even within the same client session", async () => {
    const { translator } = await createTranslatorHarness();

    await translator.translateInboundMessage({
      clientSessionId: "conn_1",
      payload: JSON.stringify({
        type: "stream.open",
        streamId: 41,
        channel: {
          kind: "pty",
          session: "create",
          ptySessionId: "terminal",
          cols: 80,
          rows: 24,
        },
      }),
      sandboxInstanceId: SandboxInstanceId,
      sourcePeerSide: "connection",
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: JSON.stringify({
          type: "stream.open",
          streamId: 41,
          channel: {
            kind: "agent",
          },
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "connection",
      }),
    ).rejects.toThrow("Client stream binding already exists for session 'conn_1' stream 41.");
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

  it("rejects telemetry control messages from connection peers", async () => {
    const { translator } = await createTranslatorHarness();

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: JSON.stringify({
          type: "telemetry.open",
          streamId: 77,
          signal: "logs",
          format: "mistle.sandbox-runtime.log.v1",
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "connection",
      }),
    ).rejects.toThrow(
      "Connection websocket cannot send telemetry control message type 'telemetry.open'.",
    );
  });

  it("keeps bootstrap telemetry opens out of the interactive stream router", async () => {
    const { router, translator } = await createTranslatorHarness();

    await expect(
      translator.translateInboundMessage({
        clientSessionId: BootstrapSessionId,
        payload: JSON.stringify({
          type: "telemetry.open",
          streamId: 51,
          signal: "logs",
          format: "mistle.sandbox-runtime.log.v1",
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "bootstrap",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "telemetryOpen",
        message: {
          type: "telemetry.open",
          streamId: 51,
          signal: "logs",
          format: "mistle.sandbox-runtime.log.v1",
        },
      },
    });

    await expect(
      router.findInteractiveStreamByTunnel({
        sandboxInstanceId: SandboxInstanceId,
        tunnelStreamId: 51,
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps unbound bootstrap raw-bytes frames out of the interactive stream router", async () => {
    const { router, translator } = await createTranslatorHarness();

    const payload = encodeDataFrame({
      streamId: 91,
      payloadKind: PayloadKindRawBytes,
      payload: new Uint8Array([1, 2, 3]),
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: BootstrapSessionId,
        payload: toArrayBuffer(payload),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "bootstrap",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "telemetryData",
        payload: toArrayBuffer(payload),
        streamId: 91,
      },
    });

    await expect(
      router.findInteractiveStreamByTunnel({
        sandboxInstanceId: SandboxInstanceId,
        tunnelStreamId: 91,
      }),
    ).resolves.toBeUndefined();
  });

  it("marks unbound bootstrap non-raw frames for local telemetry reset handling", async () => {
    const { translator } = await createTranslatorHarness();

    const payload = encodeDataFrame({
      streamId: 92,
      payloadKind: PayloadKindWebSocketText,
      payload: new TextEncoder().encode("invalid telemetry payload kind"),
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: BootstrapSessionId,
        payload: toArrayBuffer(payload),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "bootstrap",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "telemetryInvalidData",
        payloadKind: PayloadKindWebSocketText,
        streamId: 92,
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
          ptySessionId: "terminal",
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

  it("forwards fileUpload.completed but keeps the binding alive until stream.complete", async () => {
    const { translator } = await createTranslatorHarness();

    await openFileUploadStream(translator);

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

    await expect(sendBootstrapUploadCompleted(translator)).resolves.toEqual({
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
    });

    await expect(sendBootstrapStreamComplete(translator)).resolves.toEqual({
      delivery: {
        kind: "forward",
        payload: JSON.stringify({
          type: "stream.complete",
          streamId: 42,
        }),
        targetConnectionSessionId: "conn_1",
      },
      releaseInteractiveStream: {
        clientSessionId: "conn_1",
        clientStreamId: 42,
      },
    });
  });

  it("releases fileUpload binding on bootstrap stream.reset without waiting for completion", async () => {
    const { translator } = await createTranslatorHarness();

    await openFileUploadStream(translator);

    await expect(sendBootstrapUploadReset(translator)).resolves.toEqual({
      delivery: {
        kind: "forward",
        payload: JSON.stringify({
          type: "stream.reset",
          streamId: 42,
          code: "bootstrap_disconnected",
          message: "upload interrupted",
        }),
        targetConnectionSessionId: "conn_1",
      },
      releaseInteractiveStream: {
        clientSessionId: "conn_1",
        clientStreamId: 42,
      },
    });
  });

  it("drops late fileUpload.completed after the binding was already released by reset", async () => {
    const { router, translator } = await createTranslatorHarness();

    await openFileUploadStream(translator);

    const resetTranslation = await sendBootstrapUploadReset(translator);
    if (resetTranslation.releaseInteractiveStream === undefined) {
      throw new Error("Expected bootstrap stream.reset to release the upload binding.");
    }
    await router.closeInteractiveStream({
      sandboxInstanceId: SandboxInstanceId,
      clientSessionId: resetTranslation.releaseInteractiveStream.clientSessionId,
      clientStreamId: resetTranslation.releaseInteractiveStream.clientStreamId,
    });

    await expect(sendBootstrapUploadCompleted(translator)).resolves.toEqual({
      delivery: {
        kind: "drop",
      },
    });
  });

  it("drops late stream.complete after the binding was already released by reset", async () => {
    const { router, translator } = await createTranslatorHarness();

    await openFileUploadStream(translator);

    const resetTranslation = await sendBootstrapUploadReset(translator);
    if (resetTranslation.releaseInteractiveStream === undefined) {
      throw new Error("Expected bootstrap stream.reset to release the upload binding.");
    }
    await router.closeInteractiveStream({
      sandboxInstanceId: SandboxInstanceId,
      clientSessionId: resetTranslation.releaseInteractiveStream.clientSessionId,
      clientStreamId: resetTranslation.releaseInteractiveStream.clientStreamId,
    });

    await expect(sendBootstrapStreamComplete(translator)).resolves.toEqual({
      delivery: {
        kind: "drop",
      },
    });
  });

  it("drops late bootstrap stream.window after the binding was already released by pty.exit", async () => {
    const { router, translator } = await createTranslatorHarness();

    await translator.translateInboundMessage({
      clientSessionId: "conn_1",
      payload: JSON.stringify({
        type: "stream.open",
        streamId: 41,
        channel: {
          kind: "pty",
          session: "create",
          ptySessionId: "terminal",
          cols: 80,
          rows: 24,
        },
      }),
      sandboxInstanceId: SandboxInstanceId,
      sourcePeerSide: "connection",
    });

    const exitTranslation = await translator.translateInboundMessage({
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
    });
    if (exitTranslation.releaseInteractiveStream === undefined) {
      throw new Error("Expected bootstrap pty.exit to release the PTY binding.");
    }
    await router.closeInteractiveStream({
      sandboxInstanceId: SandboxInstanceId,
      clientSessionId: exitTranslation.releaseInteractiveStream.clientSessionId,
      clientStreamId: exitTranslation.releaseInteractiveStream.clientStreamId,
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: BootstrapSessionId,
        payload: JSON.stringify({
          type: "stream.window",
          streamId: 1,
          bytes: 5,
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

  it("drops late bootstrap stream.reset after the binding was already released by pty.exit", async () => {
    const { router, translator } = await createTranslatorHarness();

    await translator.translateInboundMessage({
      clientSessionId: "conn_1",
      payload: JSON.stringify({
        type: "stream.open",
        streamId: 41,
        channel: {
          kind: "pty",
          session: "create",
          ptySessionId: "terminal",
          cols: 80,
          rows: 24,
        },
      }),
      sandboxInstanceId: SandboxInstanceId,
      sourcePeerSide: "connection",
    });

    const exitTranslation = await translator.translateInboundMessage({
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
    });
    if (exitTranslation.releaseInteractiveStream === undefined) {
      throw new Error("Expected bootstrap pty.exit to release the PTY binding.");
    }
    await router.closeInteractiveStream({
      sandboxInstanceId: SandboxInstanceId,
      clientSessionId: exitTranslation.releaseInteractiveStream.clientSessionId,
      clientStreamId: exitTranslation.releaseInteractiveStream.clientStreamId,
    });

    await expect(
      translator.translateInboundMessage({
        clientSessionId: BootstrapSessionId,
        payload: JSON.stringify({
          type: "stream.reset",
          streamId: 1,
          code: "invalid_stream_window",
          message: "stream.window streamId 1 is not bound to an active tunnel stream",
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

  it("keeps bootstrap keepalive state messages local to the gateway", async () => {
    const { translator } = await createTranslatorHarness();

    await expect(
      translator.translateInboundMessage({
        clientSessionId: BootstrapSessionId,
        payload: JSON.stringify({
          type: "keepalive.state",
          ttlMs: 30_000,
          active: true,
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "bootstrap",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "drop",
      },
      keepaliveControlMessage: {
        type: "keepalive.state",
        ttlMs: 30_000,
        active: true,
      },
    });
  });

  it("keeps bootstrap runtime readiness messages local to the gateway", async () => {
    const { translator } = await createTranslatorHarness();

    await expect(
      translator.translateInboundMessage({
        clientSessionId: BootstrapSessionId,
        payload: JSON.stringify({
          type: "runtime.ready",
          ready: true,
        }),
        sandboxInstanceId: SandboxInstanceId,
        sourcePeerSide: "bootstrap",
      }),
    ).resolves.toEqual({
      delivery: {
        kind: "drop",
      },
      runtimeReadyControlMessage: {
        type: "runtime.ready",
        ready: true,
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

  it("responds with a reset and releases the binding when processes data is not websocket text", async () => {
    const { translator } = await createTranslatorHarness();

    await openProcessesStream(translator);

    await expect(
      translator.translateInboundMessage({
        clientSessionId: "conn_1",
        payload: toArrayBuffer(
          encodeDataFrame({
            streamId: 52,
            payloadKind: PayloadKindWebSocketBinary,
            payload: new Uint8Array([1, 2, 3]),
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
          streamId: 52,
          code: "invalid_stream_data",
          message: "Processes streams only accept websocket text data frames.",
        }),
      },
      notifyBootstrapPeerOfReleasedStream: {
        channelKind: "processes",
        clientSessionId: "conn_1",
        clientStreamId: 52,
        tunnelStreamId: 1,
      },
      releaseInteractiveStream: {
        clientSessionId: "conn_1",
        clientStreamId: 52,
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
