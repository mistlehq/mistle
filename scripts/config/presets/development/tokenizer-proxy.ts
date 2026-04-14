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
          base_url: "http://localhost:5100",
          public_base_url: "http://localhost:5100",
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
