import type { DevelopmentPresetModule } from "./types.ts";

export const dashboardDevelopmentPreset = {
  defaults: {
    apps: {
      dashboard: {
        control_plane_api_origin: "http://localhost:5100",
      },
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
