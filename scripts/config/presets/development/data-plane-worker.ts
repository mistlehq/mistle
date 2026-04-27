import type { DevelopmentPresetModule } from "./types.ts";

export const dataPlaneWorkerDevelopmentPreset = {
  defaults: {
    apps: {
      data_plane_worker: {
        database: {
          url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_dev",
        },
        workflow: {
          database_url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_dev",
          namespace_id: "development",
          run_migrations: true,
          concurrency: 1,
        },
        runtime_state: {
          gateway_base_url: "http://127.0.0.1:5202",
        },
        control_plane_api: {
          base_url: "http://localhost:5100",
        },
        sandbox: {
          tokenizer_proxy_egress_base_url:
            "http://tokenizer-proxy-relay:5025/tokenizer-proxy/egress",
          docker: {
            socket_path: "/var/run/docker.sock",
            network_name: "mistle-sandbox-dev",
          },
          e2b: {
            api_key: "replace-with-e2b-api-key",
            domain: "e2b.app",
          },
        },
        sandbox_storage: {
          archil: {
            api_key: "replace-with-archil-api-key",
            region: "gcp-us-central1",
            name_prefix: "mistle-",
            mounts: [
              {
                type: "s3-compatible",
                bucket: "mistle-sandbox-storage",
                endpoint: "http://seaweedfs:8333",
                access_key_id: "replace-with-archil-mount-access-key-id",
                secret_access_key: "replace-with-archil-mount-secret-access-key",
              },
            ],
          },
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
