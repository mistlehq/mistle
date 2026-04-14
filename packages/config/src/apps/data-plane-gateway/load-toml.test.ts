import { describe, expect, it } from "vitest";

import { loadDataPlaneGatewayFromToml } from "./load-toml.js";

describe("loadDataPlaneGatewayFromToml", () => {
  it("omits lifecycle when the TOML block is absent", () => {
    expect(
      loadDataPlaneGatewayFromToml({
        apps: {
          data_plane_gateway: {
            server: {
              host: "127.0.0.1",
              port: 5202,
            },
            database: {
              url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
            },
            runtime_state: {
              backend: "valkey",
              valkey: {
                url: "redis://127.0.0.1:6379",
                key_prefix: "mistle:runtime-state:test",
              },
            },
            data_plane_api: {
              base_url: "http://127.0.0.1:5200",
            },
          },
        },
      }),
    ).toEqual({
      server: {
        host: "127.0.0.1",
        port: 5202,
      },
      database: {
        url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
      },
      runtimeState: {
        backend: "valkey",
        valkey: {
          url: "redis://127.0.0.1:6379",
          keyPrefix: "mistle:runtime-state:test",
        },
      },
      dataPlaneApi: {
        baseUrl: "http://127.0.0.1:5200",
      },
    });
  });
});
