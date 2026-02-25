import { describe, expect, it } from "vitest";

import { loadConfig, parseConfigRecord } from "./loader.js";
import { AppIds } from "./modules.js";

describe("parseConfigRecord", () => {
  it("parses a minimal config record", () => {
    const configRecord = {
      global: {
        env: "development",
      },
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
            baseUrl: "http://127.0.0.1:5000",
            secret: "test-secret",
            trustedOrigins: ["http://127.0.0.1:3000"],
            otpLength: 6,
            otpExpiresInSeconds: 300,
            otpAllowedAttempts: 3,
          },
          email: {
            fromAddress: "no-reply@mistle.local",
            fromName: "Mistle Local",
            smtpHost: "127.0.0.1",
            smtpPort: 1025,
            smtpSecure: false,
            smtpUsername: "mailpit",
            smtpPassword: "mailpit",
          },
        },
      },
    };
    const config = parseConfigRecord(configRecord);

    expect(config).toEqual(configRecord);
  });
});

describe("loadConfig", () => {
  it("fails when configPath and env are both missing", () => {
    expect(() =>
      loadConfig({
        app: AppIds.CONTROL_PLANE_API,
      }),
    ).toThrowError(/Missing config source/);
  });
});
