import { describe, expect, it } from "vitest";

import { buildDashboardConfig } from "./config.js";

describe("dashboard config", () => {
  it("accepts a valid control-plane API origin", () => {
    const config = buildDashboardConfig({
      VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
    });

    expect(config.controlPlaneApiOrigin).toBe("http://localhost:3000");
  });

  it("rejects an invalid control-plane API origin", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_CONTROL_PLANE_API_ORIGIN: "localhost:3000",
      }),
    ).toThrow("VITE_CONTROL_PLANE_API_ORIGIN must be a valid absolute URL origin.");
  });

  it("requires control-plane API origin", () => {
    expect(() => buildDashboardConfig({})).toThrow("VITE_CONTROL_PLANE_API_ORIGIN is required.");
  });
});
