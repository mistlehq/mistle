// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { DASHBOARD_CAPABILITIES_QUERY_KEY } from "../dashboard/dashboard-capabilities-query.js";
import type { DashboardCapabilitiesResponse } from "../dashboard/dashboard-capabilities-service.js";
import { HOME_SUMMARY_QUERY_KEY } from "../home/home-query-keys.js";
import type { HomeSummaryResponse } from "../home/home-service.js";
import { HomePage } from "./home-page.js";

describe("HomePage", () => {
  it("shows the beta notice when the billing capability is enabled", () => {
    renderHomePage({ dashboardCapabilities: { billing: { stripe: { enabled: true } } } });

    expect(screen.getByText("Mistle Cloud Beta")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Get started" })).toBeDefined();
  });

  it("omits the beta notice when the billing capability is absent", () => {
    renderHomePage({ dashboardCapabilities: {} });

    expect(screen.queryByText("Mistle Cloud Beta")).toBeNull();
    expect(screen.getByRole("heading", { name: "Get started" })).toBeDefined();
  });
});

function renderHomePage(input: { dashboardCapabilities: DashboardCapabilitiesResponse }): void {
  const queryClient = createTestQueryClient({ staleTime: Infinity });

  queryClient.setQueryData(HOME_SUMMARY_QUERY_KEY, createOnboardingHomeSummary());
  queryClient.setQueryData(DASHBOARD_CAPABILITIES_QUERY_KEY, input.dashboardCapabilities);

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function createOnboardingHomeSummary(): HomeSummaryResponse {
  return {
    onboarding: {
      hasIntegrations: false,
      hasProfiles: false,
      hasUsableProfiles: false,
      hasStartedSession: false,
      hasWebhookCapableIntegration: false,
      hasTriggers: false,
    },
    recentSessions: [],
  };
}
