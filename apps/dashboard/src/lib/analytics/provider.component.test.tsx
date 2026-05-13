// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../../config.js";
import { AnalyticsProvider } from "./provider.js";

afterEach(() => {
  resetDashboardConfigForTest();
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
    VITE_POSTHOG_ENABLED: "false",
  });
  Reflect.deleteProperty(import.meta.env, "VITE_POSTHOG_PROJECT_API_KEY");
  Reflect.deleteProperty(import.meta.env, "VITE_POSTHOG_HOST");
});

describe("AnalyticsProvider", () => {
  it("renders children without PostHog config", () => {
    Reflect.deleteProperty(import.meta.env, "VITE_POSTHOG_ENABLED");

    render(
      <AnalyticsProvider>
        <div>Dashboard content</div>
      </AnalyticsProvider>,
    );

    expect(screen.getByText("Dashboard content")).not.toBeNull();
  });
});
