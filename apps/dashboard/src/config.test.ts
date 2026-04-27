import { afterEach, describe, expect, it } from "vitest";

import {
  buildDashboardConfig,
  getDashboardConfig,
  getDashboardGoogleAuthMethodEnabled,
  resetDashboardConfigForTest,
} from "./config.js";

function setDashboardGoogleAuthMethodFlag(value: string): void {
  Object.assign(import.meta.env, {
    VITE_AUTH_METHOD_GOOGLE: value,
  });
}

function setDashboardControlPlaneApiOrigin(value: string): void {
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: value,
  });
}

afterEach(() => {
  resetDashboardConfigForTest();
  setDashboardControlPlaneApiOrigin("http://localhost:3000");
  setDashboardGoogleAuthMethodFlag("true");
});

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

  it("parses the google auth method flag separately", () => {
    setDashboardGoogleAuthMethodFlag("true");

    expect(getDashboardGoogleAuthMethodEnabled()).toBe(true);
  });

  it("reads control-plane API origin from build-time env", () => {
    setDashboardControlPlaneApiOrigin("http://localhost:8080");

    expect(getDashboardConfig().controlPlaneApiOrigin).toBe("http://localhost:8080");
  });

  it("reads the google auth method flag from build-time env", () => {
    setDashboardGoogleAuthMethodFlag("true");

    expect(getDashboardGoogleAuthMethodEnabled()).toBe(true);
  });

  it.each([["yes"], [""]])("rejects an invalid google auth method flag: %s", (value) => {
    setDashboardGoogleAuthMethodFlag(value);

    expect(() => getDashboardGoogleAuthMethodEnabled()).toThrow(
      'VITE_AUTH_METHOD_GOOGLE must be either "true" or "false".',
    );
  });
});
