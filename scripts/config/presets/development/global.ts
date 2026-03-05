import { randomBytes } from "node:crypto";

import type { DevelopmentPresetModule } from "./types.ts";

export const globalDevelopmentPreset = {
  defaults: {
    global: {
      env: "development",
      sandbox: {
        default_base_image: "localhost:5001/mistle/sandbox-base:dev",
        gateway_ws_url: "ws://localhost:5202/tunnel/sandbox",
        internal_gateway_ws_url: "ws://host.docker.internal:5202/tunnel/sandbox",
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
