import type { DevelopmentPresetModule } from "./types.ts";

export const dataPlaneGatewayDevelopmentPreset = {
  defaults: {
    apps: {
      data_plane_gateway: {
        server: {
          host: "127.0.0.1",
          port: 5202,
        },
        database: {
          url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_dev",
        },
        runtime_state: {
          backend: "valkey",
          valkey: {
            url: "redis://127.0.0.1:6379",
            key_prefix: "mistle:runtime-state:development",
          },
        },
        data_plane_api: {
          base_url: "http://127.0.0.1:5200",
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
