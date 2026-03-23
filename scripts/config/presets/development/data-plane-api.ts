import type { DevelopmentPresetModule } from "./types.ts";

export const dataPlaneApiDevelopmentPreset = {
  defaults: {
    apps: {
      data_plane_api: {
        server: {
          host: "127.0.0.1",
          port: 5200,
        },
        database: {
          url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_dev",
        },
        workflow: {
          database_url: "postgresql://mistle:mistle@127.0.0.1:6432/mistle_dev",
          namespace_id: "development",
        },
        runtime_state: {
          gateway_base_url: "http://127.0.0.1:5202",
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
