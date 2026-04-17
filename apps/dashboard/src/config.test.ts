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

function setRuntimeDashboardConfig(value: {
  controlPlaneApiOrigin?: string;
  authMethodGoogle?: string;
}): void {
  Object.assign(globalThis, {
    __MISTLE_RUNTIME_CONFIG__: value,
  });
}

afterEach(() => {
  resetDashboardConfigForTest();
  Reflect.deleteProperty(globalThis, "__MISTLE_RUNTIME_CONFIG__");
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

  it("prefers runtime-injected config over build-time env", () => {
    Object.assign(import.meta.env, {
      VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
    });
    setRuntimeDashboardConfig({
      controlPlaneApiOrigin: "http://localhost:8080",
    });

    expect(getDashboardConfig().controlPlaneApiOrigin).toBe("http://localhost:8080");
  });

  it("reads the google auth method flag from runtime-injected config when present", () => {
    setDashboardGoogleAuthMethodFlag("false");
    setRuntimeDashboardConfig({
      authMethodGoogle: "true",
    });

    expect(getDashboardGoogleAuthMethodEnabled()).toBe(true);
  });

  it.each([["yes"], [""]])("rejects an invalid google auth method flag: %s", (value) => {
    setDashboardGoogleAuthMethodFlag(value);

    expect(() => getDashboardGoogleAuthMethodEnabled()).toThrow(
      'VITE_AUTH_METHOD_GOOGLE must be either "true" or "false".',
    );
  });
});
