// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { SCHEDULED_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY } from "../automations/use-scheduled-automation-prerequisites.js";
import {
  WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY,
  WEBHOOK_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY,
} from "../automations/use-webhook-automation-prerequisites.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { AutomationCreatePage } from "./automation-create-page.js";

function renderCreatePage(input: { initialEntry: string }): void {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  queryClient.setQueryData(WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY, {
    connections: [],
    targets: [],
  });
  queryClient.setQueryData(WEBHOOK_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY, []);
  queryClient.setQueryData(SCHEDULED_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY, []);

  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        element={<AutomationCreatePage />}
        handle={ROUTE_HANDLES.automationsNew}
        path="/automations/new"
      />,
    ),
    {
      initialEntries: [input.initialEntry],
    },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("AutomationCreatePage", () => {
  it("shows the trigger automation fields by default", () => {
    renderCreatePage({ initialEntry: "/automations/new" });

    expect(screen.getByRole("heading", { name: "Create automation" })).toBeDefined();
    expect(screen.getByText("Automation type")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Events" })).toBeDefined();
    expect(screen.getByRole("textbox", { name: "User message" })).toBeDefined();
  });

  it("shows the scheduled automation fields from the type query", () => {
    renderCreatePage({ initialEntry: "/automations/new?type=scheduled" });

    expect(screen.getByRole("heading", { name: "Create automation" })).toBeDefined();
    expect(screen.getByText("Automation type")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Schedule" })).toBeDefined();
    expect(screen.getByText("Group runs by")).toBeDefined();
    expect(screen.getAllByText("Schedule").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Cron breakdown")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "User message" })).toBeDefined();
  });
});
