import type { DevelopmentPresetModule } from "./types.ts";

export const dataPlaneGatewayDevelopmentPreset = {
  defaults: {
    apps: {
      data_plane_gateway: {
        server: {
          host: "127.0.0.1",
          port: 5202,
        },
        database: {
          url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_dev",
        },
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
