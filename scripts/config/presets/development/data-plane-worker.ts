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
          bootstrap_token_ttl_seconds: 120,
          exchange_token_ttl_seconds: 3600,
        },
        runtime_state: {
          gateway_base_url: "http://data-plane-gateway-relay:5202",
        },
        sandbox: {
          tokenizer_proxy_egress_base_url:
            "http://tokenizer-proxy-relay:5025/tokenizer-proxy/egress",
          docker: {
            socket_path: "/var/run/docker.sock",
            network_name: "mistle-sandbox-dev",
            traces_endpoint: "http://otel-lgtm:4318/v1/traces",
          },
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
