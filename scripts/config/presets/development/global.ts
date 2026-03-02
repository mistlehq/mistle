import { randomBytes } from "node:crypto";

import type { DevelopmentPresetModule } from "./types.ts";

export const globalDevelopmentPreset = {
  defaults: {
    global: {
      env: "development",
      sandbox: {
        connect: {
          token_issuer: "control-plane-api",
          token_audience: "data-plane-gateway",
        },
        bootstrap: {
          token_issuer: "data-plane-worker",
          token_audience: "data-plane-gateway",
        },
      },
    },
  },
  generators: [
    {
      path: ["global", "internal_auth", "service_token"],
      when: "always",
      generate: () => randomBytes(32).toString("base64url"),
    },
    {
      path: ["global", "sandbox", "connect", "token_secret"],
      when: "always",
      generate: () => randomBytes(32).toString("base64url"),
    },
    {
      path: ["global", "sandbox", "bootstrap", "token_secret"],
      when: "always",
      generate: () => randomBytes(32).toString("base64url"),
    },
  ],
} satisfies DevelopmentPresetModule;
