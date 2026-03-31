import { describe, expect, it } from "vitest";

import { classifyLiveListener } from "./classify-live-listener.js";

describe("classifyLiveListener", () => {
  it("marks the runtime listener as internal sandbox-runtime ownership", () => {
    expect(
      classifyLiveListener({
        discoveredListener: {
          bindAddress: "127.0.0.1",
          command: "sandboxd",
          pid: 301,
          port: 3100,
        },
        observedAt: "2026-04-01T00:00:00.000Z",
        runtimeClients: [],
        runtimeListenAddr: "127.0.0.1:3100",
      }),
    ).toEqual({
      bindAddress: "127.0.0.1",
      command: "sandboxd",
      observedAt: "2026-04-01T00:00:00.000Z",
      owner: {
        kind: "sandbox-runtime",
      },
      pid: 301,
      port: 3100,
      visibility: "internal",
    });
  });

  it("marks managed runtime client endpoint ports as internal", () => {
    expect(
      classifyLiveListener({
        discoveredListener: {
          bindAddress: "127.0.0.1",
          command: "node",
          pid: 302,
          port: 4500,
        },
        observedAt: "2026-04-01T00:00:00.000Z",
        runtimeClients: [
          {
            clientId: "codex",
            endpoints: [
              {
                connectionMode: "shared",
                endpointKey: "server",
                transport: {
                  type: "ws",
                  url: "ws://127.0.0.1:4500/session",
                },
              },
            ],
            processes: [],
            setup: {
              env: {},
              files: [],
            },
          },
        ],
        runtimeListenAddr: "127.0.0.1:3100",
      }),
    ).toEqual({
      bindAddress: "127.0.0.1",
      command: "node",
      observedAt: "2026-04-01T00:00:00.000Z",
      owner: {
        clientId: "codex",
        endpointKey: "server",
        kind: "managed-runtime-client",
      },
      pid: 302,
      port: 4500,
      visibility: "internal",
    });
  });

  it("defaults unknown loopback listeners to user_selectable", () => {
    expect(
      classifyLiveListener({
        discoveredListener: {
          bindAddress: "127.0.0.1",
          command: "vite",
          pid: 303,
          port: 5173,
        },
        observedAt: "2026-04-01T00:00:00.000Z",
        runtimeClients: [],
        runtimeListenAddr: "127.0.0.1:3100",
      }),
    ).toEqual({
      bindAddress: "127.0.0.1",
      command: "vite",
      observedAt: "2026-04-01T00:00:00.000Z",
      owner: {
        kind: "unknown-process",
      },
      pid: 303,
      port: 5173,
      visibility: "user_selectable",
    });
  });
});
