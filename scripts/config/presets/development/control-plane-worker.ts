import type { DevelopmentPresetModule } from "./types.ts";

export const controlPlaneWorkerDevelopmentPreset = {
  defaults: {
    apps: {
      control_plane_worker: {
        server: {
          host: "127.0.0.1",
          port: 5101,
        },
        workflow: {
          database_url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_dev",
          namespace_id: "development",
          run_migrations: true,
          concurrency: 1,
        },
        email: {
          from_address: "no-reply@mistle.local",
          from_name: "Mistle (Local)",
          smtp_host: "127.0.0.1",
          smtp_port: 1025,
          smtp_secure: false,
          smtp_username: "mailpit",
          smtp_password: "mailpit",
        },
        data_plane_api: {
          base_url: "http://localhost:5200",
        },
        control_plane_api: {
          base_url: "http://localhost:5100",
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
