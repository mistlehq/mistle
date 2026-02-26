import type { DevelopmentPresetModule } from "./types.ts";

export const dataPlaneWorkerDevelopmentPreset = {
  defaults: {
    apps: {
      data_plane_worker: {
        server: {
          host: "127.0.0.1",
          port: 5201,
        },
        database: {
          url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_data_plane",
        },
        workflow: {
          database_url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_data_plane",
          namespace_id: "development",
          run_migrations: true,
          concurrency: 1,
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
