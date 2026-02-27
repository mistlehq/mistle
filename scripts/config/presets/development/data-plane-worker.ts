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
          url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_dev",
        },
        workflow: {
          database_url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_dev",
          namespace_id: "development",
          run_migrations: true,
          concurrency: 1,
        },
        sandbox: {
          provider: "modal",
          modal: {
            token_id: "change-me",
            token_secret: "change-me",
            app_name: "mistle-sandbox",
            environment_name: "development",
          },
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
