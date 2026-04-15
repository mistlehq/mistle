// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY,
  WEBHOOK_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY,
} from "../automations/use-webhook-automation-prerequisites.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { WebhookAutomationEditorPage } from "./webhook-automation-editor-page.js";

describe("WebhookAutomationEditorPage", () => {
  it("does not render a page header description on the create route", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    queryClient.setQueryData(WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY, {
      connections: [],
      targets: [],
    });
    queryClient.setQueryData(WEBHOOK_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY, []);

    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Outlet />} path="/">
          <Route element={<Outlet />} handle={ROUTE_HANDLES.automations} path="automations">
            <Route
              element={<WebhookAutomationEditorPage mode="create" />}
              handle={ROUTE_HANDLES.automationsNew}
              path="new"
            />
          </Route>
        </Route>,
      ),
      {
        initialEntries: ["/automations/new"],
      },
    );

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Create automation" })).toBeDefined();
    expect(container.querySelector('[data-slot="page-header-description"]')).toBeNull();
    const editorText = screen.getByRole("textbox", { name: "Message Template" }).textContent;

    expect(editorText).toContain("Event type: {{webhookEvent.eventType}}");
    expect(editorText).toContain("Payload: {{payload}}");
    expect(screen.getByRole("textbox", { name: "Automation Instructions" })).toBeDefined();
  });
});
