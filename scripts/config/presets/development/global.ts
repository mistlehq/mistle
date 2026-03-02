import { randomBytes } from "node:crypto";

import type { DevelopmentPresetModule } from "./types.ts";

export const globalDevelopmentPreset = {
  defaults: {
    global: {
      env: "development",
      tunnel: {
        token_issuer: "data-plane-worker",
        token_audience: "data-plane-gateway",
      },
      connection_tokens: {
        issuer: "control-plane-api",
        audience: "data-plane-gateway",
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
      path: ["global", "tunnel", "bootstrap_token_secret"],
      when: "always",
      generate: () => randomBytes(32).toString("base64url"),
    },
    {
      path: ["global", "connection_tokens", "secret"],
      when: "always",
      generate: () => randomBytes(32).toString("base64url"),
    },
  ],
} satisfies DevelopmentPresetModule;
