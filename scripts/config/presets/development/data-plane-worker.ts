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
        tunnel: {
          gateway_ws_url: "ws://127.0.0.1:5202/tunnel/sandbox",
          bootstrap_token_ttl_seconds: 120,
        },
        sandbox: {
          provider: "docker",
          docker: {
            socket_path: "/var/run/docker.sock",
            snapshot_repository: "127.0.0.1:5001/mistle/snapshots",
          },
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
