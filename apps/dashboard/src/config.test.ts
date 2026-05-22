import { afterEach, describe, expect, it } from "vitest";

import { buildDashboardConfig, getDashboardConfig, resetDashboardConfigForTest } from "./config.js";

function setDashboardControlPlaneApiOrigin(value: string): void {
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: value,
    VITE_MISTLE_RELEASE_VERSION: "0.18.1",
  });
}

function clearDashboardPostHogEnv(): void {
  Reflect.deleteProperty(import.meta.env, "VITE_POSTHOG_ENABLED");
  Reflect.deleteProperty(import.meta.env, "VITE_POSTHOG_PROJECT_API_KEY");
  Reflect.deleteProperty(import.meta.env, "VITE_POSTHOG_HOST");
}

afterEach(() => {
  resetDashboardConfigForTest();
  setDashboardControlPlaneApiOrigin("http://localhost:3000");
  clearDashboardPostHogEnv();
  Reflect.deleteProperty(globalThis, "location");
});

describe("dashboard config", () => {
  it("accepts a valid control-plane API origin", () => {
    const config = buildDashboardConfig({
      VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
      VITE_MISTLE_RELEASE_VERSION: "0.18.1",
    });

    expect(config.controlPlaneApiOrigin).toBe("http://localhost:3000");
    expect(config.releaseVersion).toBe("0.18.1");
    expect(config.posthog).toEqual({ enabled: false });
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
      VITE_MISTLE_RELEASE_VERSION: "0.18.1",
    });

    expect(config.controlPlaneApiOrigin).toBe("https://dashboard.example.test");
  });

  it("rejects an invalid control-plane API origin", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_CONTROL_PLANE_API_ORIGIN: "localhost:3000",
        VITE_MISTLE_RELEASE_VERSION: "0.18.1",
      }),
    ).toThrow("VITE_CONTROL_PLANE_API_ORIGIN must be a valid absolute URL origin.");
  });

  it("requires control-plane API origin", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_MISTLE_RELEASE_VERSION: "0.18.1",
      }),
    ).toThrow("VITE_CONTROL_PLANE_API_ORIGIN is required.");
  });

  it("requires release version", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
      }),
    ).toThrow("VITE_MISTLE_RELEASE_VERSION is required.");
  });

  it("reads control-plane API origin from build-time env", () => {
    setDashboardControlPlaneApiOrigin("http://localhost:8080");

    expect(getDashboardConfig().controlPlaneApiOrigin).toBe("http://localhost:8080");
  });

  it("keeps PostHog disabled when no PostHog env is provided", () => {
    const config = buildDashboardConfig({
      VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
      VITE_MISTLE_RELEASE_VERSION: "0.18.1",
    });

    expect(config.posthog).toEqual({ enabled: false });
  });

  it("loads enabled PostHog config from build-time env", () => {
    const config = buildDashboardConfig({
      VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
      VITE_MISTLE_RELEASE_VERSION: "0.18.1",
      VITE_POSTHOG_ENABLED: "true",
      VITE_POSTHOG_PROJECT_API_KEY: "phc_example",
      VITE_POSTHOG_HOST: "https://us.i.posthog.com",
    });

    expect(config.posthog).toEqual({
      enabled: true,
      projectApiKey: "phc_example",
      host: "https://us.i.posthog.com",
    });
  });

  it("requires PostHog project API key when PostHog is enabled", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
        VITE_MISTLE_RELEASE_VERSION: "0.18.1",
        VITE_POSTHOG_ENABLED: "true",
        VITE_POSTHOG_HOST: "https://us.i.posthog.com",
      }),
    ).toThrow("VITE_POSTHOG_PROJECT_API_KEY is required when VITE_POSTHOG_ENABLED is true.");
  });

  it("requires PostHog host when PostHog is enabled", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
        VITE_MISTLE_RELEASE_VERSION: "0.18.1",
        VITE_POSTHOG_ENABLED: "true",
        VITE_POSTHOG_PROJECT_API_KEY: "phc_example",
      }),
    ).toThrow("VITE_POSTHOG_HOST is required when VITE_POSTHOG_ENABLED is true.");
  });

  it("rejects invalid PostHog enabled values", () => {
    expect(() =>
      buildDashboardConfig({
        VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
        VITE_MISTLE_RELEASE_VERSION: "0.18.1",
        VITE_POSTHOG_ENABLED: "yes",
      }),
    ).toThrow('VITE_POSTHOG_ENABLED must be either "true" or "false".');
  });
});
