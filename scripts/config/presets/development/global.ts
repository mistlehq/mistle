import type { DevelopmentPresetModule } from "./types.ts";

export const globalDevelopmentPreset = {
  defaults: {
    global: {
      env: "development",
    },
  },
  generators: [],
} satisfies DevelopmentPresetModule;
