import { randomBytes } from "node:crypto";

import type { DevelopmentPresetModule } from "./types.ts";

export const globalDevelopmentPreset = {
  defaults: {
    global: {
      env: "development",
    },
  },
  generators: [
    {
      path: ["global", "internal_auth", "service_token"],
      when: "always",
      generate: () => randomBytes(32).toString("base64url"),
    },
  ],
} satisfies DevelopmentPresetModule;
