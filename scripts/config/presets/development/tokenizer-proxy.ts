import type { DevelopmentPresetModule } from "./types.ts";

export const tokenizerProxyDevelopmentPreset = {
  defaults: {
    apps: {
      tokenizer_proxy: {
        server: {
          host: "127.0.0.1",
          port: 5205,
        },
        control_plane_api: {
          base_url: "http://127.0.0.1:5100",
        },
        credential_resolver: {
          request_timeout_ms: 3000,
        },
        cache: {
          max_entries: 8192,
          default_ttl_seconds: 300,
          refresh_skew_seconds: 30,
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
