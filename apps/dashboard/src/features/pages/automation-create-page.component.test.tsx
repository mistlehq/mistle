// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { AUTOMATION_SANDBOX_PROFILES_QUERY_KEY } from "../automations/use-automation-sandbox-profile-options.js";
import { WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY } from "../automations/use-webhook-automation-prerequisites.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { AutomationCreatePage } from "./automation-create-page.js";

function renderCreatePage(input: {
  initialEntry: string;
  shouldSeedIntegrationDirectory?: boolean;
}): ReturnType<typeof createMemoryRouter> {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (input.shouldSeedIntegrationDirectory ?? true) {
    queryClient.setQueryData(WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY, {
      connections: [],
      targets: [],
    });
  }

  queryClient.setQueryData(AUTOMATION_SANDBOX_PROFILES_QUERY_KEY, []);

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

  return router;
}

describe("AutomationCreatePage", () => {
  it("starts without a selected automation type", () => {
    renderCreatePage({ initialEntry: "/automations/new" });

    expect(
      screen.getByRole("region", { name: "Create automation page" }).getAttribute("style"),
    ).toBe("scrollbar-gutter: stable;");
    expect(screen.getByRole("heading", { name: "Create automation" })).toBeDefined();
    expect(screen.getByText("Automation type")).toBeDefined();
    expect(screen.getByText("Select type")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Events" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Schedule" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "User message" })).toBeNull();
  });

  it("orders the create form fields by profile, type, and name", () => {
    renderCreatePage({ initialEntry: "/automations/new" });

    const sandboxProfileLabel = screen.getByText("Sandbox profile");
    const automationTypeLabel = screen.getByText("Automation type");
    const automationNameLabel = screen.getByText("Automation name");

    expect(sandboxProfileLabel.compareDocumentPosition(automationTypeLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(automationTypeLabel.compareDocumentPosition(automationNameLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("ignores type query values when choosing the initial automation type", () => {
    renderCreatePage({ initialEntry: "/automations/new?type=event" });

    expect(screen.getByRole("heading", { name: "Create automation" })).toBeDefined();
    expect(screen.getByText("Automation type")).toBeDefined();
    expect(screen.getByText("Select type")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Events" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Schedule" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "User message" })).toBeNull();
  });

  it("requires the user to select an automation type before creating", () => {
    renderCreatePage({ initialEntry: "/automations/new" });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByText("Select an automation type.")).toBeDefined();
    expect(screen.getByText("Please address the fields highlighted in red.")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Events" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "User message" })).toBeNull();
  });
});
