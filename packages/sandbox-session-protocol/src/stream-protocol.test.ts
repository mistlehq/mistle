import { describe, expect, it } from "vitest";

import {
  parseBootstrapControlMessage,
  parsePortsControlMessage,
  parsePortsTransportMessage,
  parseProcessesStreamMessage,
  parseStreamControlMessage,
  parseTelemetryControlMessage,
} from "./stream-protocol.js";

describe("stream control message parser", () => {
  it("parses pty stream opens into the shared control shape", () => {
    const message = parseStreamControlMessage(
      JSON.stringify({
        type: "stream.open",
        streamId: 17,
        channel: {
          kind: "pty",
          session: "create",
          ptySessionId: "terminal",
          cols: 120,
          rows: 40,
          cwd: "/workspace/repo",
          ignored: true,
        },
      }),
    );

    expect(message).toEqual({
      type: "stream.open",
      streamId: 17,
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "terminal",
        cols: 120,
        rows: 40,
        cwd: "/workspace/repo",
      },
    });
  });

  it("parses pty stream opens with an explicit startup command", () => {
    const message = parseStreamControlMessage(
      JSON.stringify({
        type: "stream.open",
        streamId: 18,
        channel: {
          kind: "pty",
          session: "create",
          ptySessionId: "cli",
          cols: 120,
          rows: 40,
          command: "codex",
          args: ["resume", "--remote", "ws://127.0.0.1:4500", "thread_123"],
        },
      }),
    );

    expect(message).toEqual({
      type: "stream.open",
      streamId: 18,
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "cli",
        cols: 120,
        rows: 40,
        command: "codex",
        args: ["resume", "--remote", "ws://127.0.0.1:4500", "thread_123"],
      },
    });
  });

  it("rejects malformed pty stream opens", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 17,
          channel: {
            kind: "pty",
            session: "create",
            cols: "120",
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("parses file upload stream opens", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 23,
          channel: {
            kind: "fileUpload",
            threadId: "thread_123",
            mimeType: "image/png",
            originalFilename: "screenshot.png",
            sizeBytes: 1024,
            ignored: true,
          },
        }),
      ),
    ).toEqual({
      type: "stream.open",
      streamId: 23,
      channel: {
        kind: "fileUpload",
        threadId: "thread_123",
        mimeType: "image/png",
        originalFilename: "screenshot.png",
        sizeBytes: 1024,
      },
    });
  });

  it("parses exec stream opens", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 29,
          channel: {
            kind: "exec",
            command: "git",
            args: ["diff", "--merge-base", "main...HEAD"],
            cwd: "/workspace/repo",
            timeoutMs: 15000,
            maxOutputBytes: 65536,
            ignored: true,
          },
        }),
      ),
    ).toEqual({
      type: "stream.open",
      streamId: 29,
      channel: {
        kind: "exec",
        command: "git",
        args: ["diff", "--merge-base", "main...HEAD"],
        cwd: "/workspace/repo",
        timeoutMs: 15000,
        maxOutputBytes: 65536,
      },
    });
  });

  it("rejects malformed exec stream opens", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 29,
          channel: {
            kind: "exec",
            command: "",
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects malformed file upload stream opens", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 23,
          channel: {
            kind: "fileUpload",
            threadId: "thread_123",
            mimeType: "image/png",
            originalFilename: "screenshot.png",
            sizeBytes: "1024",
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("parses stream events and resets", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.event",
          streamId: 8,
          event: {
            type: "pty.exit",
            exitCode: 0,
          },
        }),
      ),
    ).toEqual({
      type: "stream.event",
      streamId: 8,
      event: {
        type: "pty.exit",
        exitCode: 0,
      },
    });

    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.complete",
          streamId: 8,
        }),
      ),
    ).toEqual({
      type: "stream.complete",
      streamId: 8,
    });

    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.reset",
          streamId: 8,
          code: "target_closed",
          message: "target closed stream",
        }),
      ),
    ).toEqual({
      type: "stream.reset",
      streamId: 8,
      code: "target_closed",
      message: "target closed stream",
    });

    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.event",
          streamId: 9,
          event: {
            type: "fileUpload.completed",
            attachmentId: "att_123",
            threadId: "thread_123",
            originalFilename: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            path: "/root/.local/attachments/thread_123/upload.png",
          },
        }),
      ),
    ).toEqual({
      type: "stream.event",
      streamId: 9,
      event: {
        type: "fileUpload.completed",
        attachmentId: "att_123",
        threadId: "thread_123",
        originalFilename: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        path: "/root/.local/attachments/thread_123/upload.png",
      },
    });

    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.event",
          streamId: 10,
          event: {
            type: "exec.result",
            exitCode: 0,
            stdout: "diff --git a/file b/file\n",
            stderr: "",
            truncated: false,
          },
        }),
      ),
    ).toEqual({
      type: "stream.event",
      streamId: 10,
      event: {
        type: "exec.result",
        exitCode: 0,
        stdout: "diff --git a/file b/file\n",
        stderr: "",
        truncated: false,
      },
    });
  });

  it("rejects malformed stream.complete messages", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.complete",
          streamId: "8",
        }),
      ),
    ).toBeUndefined();
  });

  it("parses telemetry control messages", () => {
    expect(
      parseTelemetryControlMessage(
        JSON.stringify({
          type: "telemetry.open",
          streamId: 31,
          signal: "logs",
          format: "mistle.sandbox-runtime.log.v1",
        }),
      ),
    ).toEqual({
      type: "telemetry.open",
      streamId: 31,
      signal: "logs",
      format: "mistle.sandbox-runtime.log.v1",
    });

    expect(
      parseTelemetryControlMessage(
        JSON.stringify({
          type: "telemetry.open",
          streamId: 32,
          signal: "traces",
          format: "otlp.http.traces.v1+json",
        }),
      ),
    ).toEqual({
      type: "telemetry.open",
      streamId: 32,
      signal: "traces",
      format: "otlp.http.traces.v1+json",
    });

    expect(
      parseTelemetryControlMessage(
        JSON.stringify({
          type: "telemetry.reset",
          streamId: 31,
          code: "telemetry_stream_not_found",
          message: "stream not found",
        }),
      ),
    ).toEqual({
      type: "telemetry.reset",
      streamId: 31,
      code: "telemetry_stream_not_found",
      message: "stream not found",
    });
  });

  it("allows bootstrap telemetry open and close messages", () => {
    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "telemetry.open",
          streamId: 41,
          signal: "logs",
          format: "mistle.sandbox-runtime.log.v1",
        }),
      ),
    ).toEqual({
      type: "telemetry.open",
      streamId: 41,
      signal: "logs",
      format: "mistle.sandbox-runtime.log.v1",
    });

    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "telemetry.open",
          streamId: 42,
          signal: "traces",
          format: "otlp.http.traces.v1+json",
        }),
      ),
    ).toEqual({
      type: "telemetry.open",
      streamId: 42,
      signal: "traces",
      format: "otlp.http.traces.v1+json",
    });

    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "telemetry.close",
          streamId: 41,
        }),
      ),
    ).toEqual({
      type: "telemetry.close",
      streamId: 41,
    });
  });

  it("rejects gateway-only telemetry control messages from bootstrap parsing", () => {
    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "telemetry.open.ok",
          streamId: 41,
          initialWindowBytes: 65536,
        }),
      ),
    ).toBeUndefined();
  });

  it("parses bootstrap keepalive state messages", () => {
    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "keepalive.state",
          ttlMs: 30_000,
          active: true,
        }),
      ),
    ).toEqual({
      type: "keepalive.state",
      ttlMs: 30_000,
      active: true,
    });
  });

  it("parses bootstrap runtime readiness messages", () => {
    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "runtime.ready",
          ready: true,
        }),
      ),
    ).toEqual({
      type: "runtime.ready",
      ready: true,
    });
  });

  it("keeps stream and bootstrap control parsers scoped correctly", () => {
    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "keepalive.state",
          ttlMs: 30_000,
          active: false,
        }),
      ),
    ).toEqual({
      type: "keepalive.state",
      ttlMs: 30_000,
      active: false,
    });

    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "keepalive.state",
          ttlMs: 30_000,
          active: false,
        }),
      ),
    ).toBeUndefined();

    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "runtime.ready",
          ready: false,
        }),
      ),
    ).toEqual({
      type: "runtime.ready",
      ready: false,
    });

    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "runtime.ready",
          ready: false,
        }),
      ),
    ).toBeUndefined();

    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "stream.complete",
          streamId: 17,
        }),
      ),
    ).toEqual({
      type: "stream.complete",
      streamId: 17,
    });

    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 17,
          channel: {
            kind: "agent",
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("parses processes stream opens", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 31,
          channel: {
            kind: "processes",
            ignored: true,
          },
        }),
      ),
    ).toEqual({
      type: "stream.open",
      streamId: 31,
      channel: {
        kind: "processes",
      },
    });
  });
});

describe("processes stream message parser", () => {
  it("parses processes snapshots", () => {
    expect(
      parseProcessesStreamMessage(
        JSON.stringify({
          type: "processes.snapshot",
          observedAt: "2026-04-10T10:15:00.000Z",
          processes: [
            {
              pid: 123,
              command: "vite",
              listeners: [
                {
                  port: 5173,
                  bindAddress: "127.0.0.1",
                },
              ],
            },
            {
              pid: 456,
              listeners: [],
            },
          ],
        }),
      ),
    ).toEqual({
      type: "processes.snapshot",
      observedAt: "2026-04-10T10:15:00.000Z",
      processes: [
        {
          pid: 123,
          command: "vite",
          listeners: [
            {
              port: 5173,
              bindAddress: "127.0.0.1",
            },
          ],
        },
        {
          pid: 456,
          listeners: [],
        },
      ],
    });
  });

  it("parses refresh requests", () => {
    expect(
      parseProcessesStreamMessage(
        JSON.stringify({
          type: "processes.refresh",
        }),
      ),
    ).toEqual({
      type: "processes.refresh",
    });
  });

  it("rejects malformed process entries", () => {
    expect(
      parseProcessesStreamMessage(
        JSON.stringify({
          type: "processes.snapshot",
          observedAt: "2026-04-10T10:15:00.000Z",
          processes: [
            {
              pid: "123",
              listeners: [],
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });
});

describe("ports control message parser", () => {
  it("parses target authorize requests", () => {
    expect(
      parsePortsControlMessage(
        JSON.stringify({
          type: "ports.target.authorize",
          requestId: "req_port_access_1",
          target: {
            kind: "port",
            port: 5173,
          },
        }),
      ),
    ).toEqual({
      type: "ports.target.authorize",
      requestId: "req_port_access_1",
      target: {
        kind: "port",
        port: 5173,
      },
    });
  });

  it("parses successful target authorize results", () => {
    expect(
      parsePortsControlMessage(
        JSON.stringify({
          type: "ports.target.authorize.result",
          requestId: "req_port_access_1",
          authorized: true,
          upstreamProtocol: "https",
          websocketCapable: true,
        }),
      ),
    ).toEqual({
      type: "ports.target.authorize.result",
      requestId: "req_port_access_1",
      authorized: true,
      upstreamProtocol: "https",
      websocketCapable: true,
    });
  });

  it("parses failed target authorize results", () => {
    expect(
      parsePortsControlMessage(
        JSON.stringify({
          type: "ports.target.authorize.result",
          requestId: "req_port_access_2",
          authorized: false,
          reason: "unsupported_protocol",
        }),
      ),
    ).toEqual({
      type: "ports.target.authorize.result",
      requestId: "req_port_access_2",
      authorized: false,
      reason: "unsupported_protocol",
    });
  });

  it("rejects malformed target authorize messages", () => {
    expect(
      parsePortsControlMessage(
        JSON.stringify({
          type: "ports.target.authorize",
          requestId: "req_port_access_3",
          target: {
            kind: "port",
            port: "5173",
          },
        }),
      ),
    ).toBeUndefined();
  });
});

describe("ports transport message parser", () => {
  it("parses ports.http.open messages", () => {
    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.http.open",
          streamId: 41,
          target: {
            kind: "port",
            port: 5173,
          },
          upstreamProtocol: "https",
          request: {
            method: "GET",
            path: "/src/main.ts",
            query: "import=1",
            headers: {
              accept: ["text/plain"],
              "x-forwarded-host": ["p-5173--sandbox.mistle.example.test"],
            },
          },
        }),
      ),
    ).toEqual({
      type: "ports.http.open",
      streamId: 41,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "https",
      request: {
        method: "GET",
        path: "/src/main.ts",
        query: "import=1",
        headers: {
          accept: ["text/plain"],
          "x-forwarded-host": ["p-5173--sandbox.mistle.example.test"],
        },
      },
    });
  });

  it("parses ports.http response and body messages", () => {
    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.http.response.start",
          streamId: 41,
          status: 200,
          headers: {
            "content-type": ["text/html; charset=utf-8"],
          },
        }),
      ),
    ).toEqual({
      type: "ports.http.response.start",
      streamId: 41,
      status: 200,
      headers: {
        "content-type": ["text/html; charset=utf-8"],
      },
    });

    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.http.body.chunk",
          streamId: 41,
          direction: "response",
          bytes: "SGVsbG8=",
          encoding: "base64",
        }),
      ),
    ).toEqual({
      type: "ports.http.body.chunk",
      streamId: 41,
      direction: "response",
      bytes: "SGVsbG8=",
      encoding: "base64",
    });

    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.http.body.end",
          streamId: 41,
          direction: "response",
        }),
      ),
    ).toEqual({
      type: "ports.http.body.end",
      streamId: 41,
      direction: "response",
    });
  });

  it("parses ports stream close and error messages", () => {
    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.stream.close",
          streamId: 41,
        }),
      ),
    ).toEqual({
      type: "ports.stream.close",
      streamId: 41,
    });

    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.stream.error",
          streamId: 41,
          code: "upstream_io_error",
          message: "upstream closed early",
        }),
      ),
    ).toEqual({
      type: "ports.stream.error",
      streamId: 41,
      code: "upstream_io_error",
      message: "upstream closed early",
    });
  });

  it("parses ports.ws messages", () => {
    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.ws.open",
          streamId: 55,
          target: {
            kind: "port",
            port: 5173,
          },
          upstreamProtocol: "https",
          request: {
            path: "/hmr",
            query: "token=1",
            headers: {
              connection: ["Upgrade"],
              upgrade: ["websocket"],
            },
          },
        }),
      ),
    ).toEqual({
      type: "ports.ws.open",
      streamId: 55,
      target: {
        kind: "port",
        port: 5173,
      },
      upstreamProtocol: "https",
      request: {
        path: "/hmr",
        query: "token=1",
        headers: {
          connection: ["Upgrade"],
          upgrade: ["websocket"],
        },
      },
    });

    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.ws.accept",
          streamId: 55,
          headers: {
            "sec-websocket-accept": ["digest"],
          },
        }),
      ),
    ).toEqual({
      type: "ports.ws.accept",
      streamId: 55,
      headers: {
        "sec-websocket-accept": ["digest"],
      },
    });

    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.ws.frame",
          streamId: 55,
          direction: "response",
          opcode: "text",
          bytes: "SGVsbG8=",
          encoding: "base64",
        }),
      ),
    ).toEqual({
      type: "ports.ws.frame",
      streamId: 55,
      direction: "response",
      opcode: "text",
      bytes: "SGVsbG8=",
      encoding: "base64",
    });

    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.ws.close",
          streamId: 55,
          direction: "request",
          code: 1000,
          reason: "normal",
        }),
      ),
    ).toEqual({
      type: "ports.ws.close",
      streamId: 55,
      direction: "request",
      code: 1000,
      reason: "normal",
    });

    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.ws.close",
          streamId: 56,
          direction: "response",
        }),
      ),
    ).toEqual({
      type: "ports.ws.close",
      streamId: 56,
      direction: "response",
    });
  });

  it("rejects malformed ports.http messages", () => {
    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.http.open",
          streamId: 41,
          target: {
            kind: "port",
            port: 5173,
          },
          upstreamProtocol: "http",
          request: {
            method: "GET",
            path: "/",
            headers: {
              accept: "text/plain",
            },
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects malformed ports.ws messages", () => {
    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.ws.open",
          streamId: 55,
          target: {
            kind: "port",
            port: 5173,
          },
          upstreamProtocol: "tcp",
          request: {
            path: "/hmr",
            headers: {
              upgrade: ["websocket"],
            },
          },
        }),
      ),
    ).toBeUndefined();

    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.ws.frame",
          streamId: 55,
          direction: "response",
          opcode: "continuation",
          bytes: "SGVsbG8=",
          encoding: "base64",
        }),
      ),
    ).toBeUndefined();

    expect(
      parsePortsTransportMessage(
        JSON.stringify({
          type: "ports.ws.close",
          streamId: 55,
          direction: "response",
          reason: "normal",
        }),
      ),
    ).toBeUndefined();
  });
});
