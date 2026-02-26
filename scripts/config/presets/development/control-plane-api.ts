import { randomBytes } from "node:crypto";

import type { DevelopmentPresetModule } from "./types.ts";

export const controlPlaneApiDevelopmentPreset = {
  defaults: {
    apps: {
      control_plane_api: {
        server: {
          host: "127.0.0.1",
          port: 5100,
        },
        database: {
          url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_dev",
        },
        auth: {
          base_url: "http://127.0.0.1:5100",
          trusted_origins: [
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
          ],
          otp_length: 6,
          otp_expires_in_seconds: 300,
          otp_allowed_attempts: 3,
        },
        workflow: {
          database_url: "postgresql://mistle:mistle@127.0.0.1:6432/mistle_dev",
          namespace_id: "development",
        },
      },
    },
  },
  generators: [
    {
      path: ["apps", "control_plane_api", "auth", "secret"],
      when: "always",
      generate: () => randomBytes(32).toString("base64url"),
    },
  ],
} satisfies DevelopmentPresetModule;
