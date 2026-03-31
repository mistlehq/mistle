import { describe, expect, it } from "vitest";

import { buildDashboardConfig } from "./config.js";

describe("dashboard config", () => {
  it("accepts a valid control-plane API origin", () => {
    const config = buildDashboardConfig({
      VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
      VITE_AUTH_METHOD_EMAIL_OTP: "true",
      VITE_AUTH_METHOD_GOOGLE: "false",
    });

    expect(config.controlPlaneApiOrigin).toBe("http://localhost:3000");
    expect(config.authMethods).toEqual({
      emailOtp: true,
      google: false,
    });
  });

  it("rejects an invalid control-plane API origin", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_CONTROL_PLANE_API_ORIGIN: "localhost:3000",
        VITE_AUTH_METHOD_EMAIL_OTP: "true",
        VITE_AUTH_METHOD_GOOGLE: "false",
      }),
    ).toThrow("VITE_CONTROL_PLANE_API_ORIGIN must be a valid absolute URL origin.");
  });

  it("requires control-plane API origin", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_AUTH_METHOD_EMAIL_OTP: "true",
        VITE_AUTH_METHOD_GOOGLE: "false",
      }),
    ).toThrow("VITE_CONTROL_PLANE_API_ORIGIN is required.");
  });

  it("requires auth method configuration", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
      }),
    ).toThrow("VITE_AUTH_METHOD_EMAIL_OTP is required.");
  });

  it("rejects invalid auth method booleans", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
        VITE_AUTH_METHOD_EMAIL_OTP: "yes",
        VITE_AUTH_METHOD_GOOGLE: "false",
      }),
    ).toThrow('VITE_AUTH_METHOD_EMAIL_OTP must be either "true" or "false".');
  });
});
