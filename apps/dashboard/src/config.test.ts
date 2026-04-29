import { afterEach, describe, expect, it } from "vitest";

import { buildDashboardConfig, getDashboardConfig, resetDashboardConfigForTest } from "./config.js";

function setDashboardControlPlaneApiOrigin(value: string): void {
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: value,
  });
}

afterEach(() => {
  resetDashboardConfigForTest();
  setDashboardControlPlaneApiOrigin("http://localhost:3000");
  Reflect.deleteProperty(globalThis, "location");
});

describe("dashboard config", () => {
  it("accepts a valid control-plane API origin", () => {
    const config = buildDashboardConfig({
      VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
    });

    expect(config.controlPlaneApiOrigin).toBe("http://localhost:3000");
  });

  it("resolves same-origin control-plane API origin from the browser location", () => {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: {
        origin: "https://dashboard.example.test",
      },
    });

    const config = buildDashboardConfig({
      VITE_CONTROL_PLANE_API_ORIGIN: "same-origin",
    });

    expect(config.controlPlaneApiOrigin).toBe("https://dashboard.example.test");
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

  it("reads control-plane API origin from build-time env", () => {
    setDashboardControlPlaneApiOrigin("http://localhost:8080");

    expect(getDashboardConfig().controlPlaneApiOrigin).toBe("http://localhost:8080");
  });
});
