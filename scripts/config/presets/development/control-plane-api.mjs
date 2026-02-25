import { randomBytes } from "node:crypto";

export const controlPlaneApiDevelopmentPreset = {
  defaults: {
    apps: {
      control_plane_api: {
        server: {
          host: "127.0.0.1",
          port: 5000,
        },
        database: {
          url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_control_plane",
        },
        auth: {
          base_url: "http://127.0.0.1:5000",
          trusted_origins: ["http://127.0.0.1:3000", "http://localhost:3000"],
          otp_length: 6,
          otp_expires_in_seconds: 300,
          otp_allowed_attempts: 3,
        },
        email: {
          from_address: "no-reply@mistle.local",
          from_name: "Mistle (Local)",
          smtp_host: "127.0.0.1",
          smtp_port: 1025,
          smtp_secure: false,
          smtp_username: "mailpit",
          smtp_password: "mailpit",
        },
      },
    },
  },
  generators: [
    {
      path: ["apps", "control_plane_api", "auth", "secret"],
      when: "missing",
      generate: () => randomBytes(32).toString("hex"),
    },
  ],
};
