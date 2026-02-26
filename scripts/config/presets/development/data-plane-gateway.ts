import type { DevelopmentPresetModule } from "./types.ts";

export const dataPlaneGatewayDevelopmentPreset = {
  defaults: {
    apps: {
      data_plane_gateway: {
        server: {
          host: "127.0.0.1",
          port: 5202,
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
