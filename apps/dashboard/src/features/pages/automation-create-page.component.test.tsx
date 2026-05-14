// @vitest-environment jsdom

import { SlackBrowserDefinition } from "@mistle/integrations-definitions/browser";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { AUTOMATION_SANDBOX_PROFILES_QUERY_KEY } from "../automations/use-automation-sandbox-profile-options.js";
import {
  WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY,
  WEBHOOK_AUTOMATION_WEBHOOK_SOURCES_QUERY_KEY_PREFIX,
} from "../automations/use-webhook-automation-prerequisites.js";
import { createStoryWebhookTriggerCapabilitiesProviderMetadata } from "../integrations/integration-story-harness.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import {
  sandboxProfileVersionAutomationConfigQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { AutomationCreatePage } from "./automation-create-page.js";

const SlackConnectionId = "icn_slack_test";
const SandboxProfileId = "sbp_slack_test";

function renderCreatePage(input: {
  initialEntry: string;
  seedSlackProfile?: boolean;
  shouldSeedIntegrationDirectory?: boolean;
}): ReturnType<typeof createMemoryRouter> {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (input.shouldSeedIntegrationDirectory ?? true) {
    queryClient.setQueryData(WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY, {
      connections:
        input.seedSlackProfile === true
          ? [
              {
                id: SlackConnectionId,
                targetKey: "slack-default",
                displayName: "Slack Engineering",
                status: "active",
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-08T00:00:00.000Z",
              },
            ]
          : [],
      targets:
        input.seedSlackProfile === true
          ? [
              {
                targetKey: "slack-default",
                familyId: SlackBrowserDefinition.familyId,
                variantId: SlackBrowserDefinition.variantId,
                kind: SlackBrowserDefinition.kind,
                enabled: true,
                config: {},
                displayName: SlackBrowserDefinition.displayName,
                description: "Slack workspace",
                ...(SlackBrowserDefinition.logoKey === undefined
                  ? {}
                  : { logoKey: SlackBrowserDefinition.logoKey }),
                supportedWebhookEvents: SlackBrowserDefinition.supportedWebhookEvents,
                targetHealth: {
                  configStatus: "valid",
                },
              },
            ]
          : [],
    });

    if (input.seedSlackProfile === true) {
      queryClient.setQueryData(
        [...WEBHOOK_AUTOMATION_WEBHOOK_SOURCES_QUERY_KEY_PREFIX, SlackConnectionId],
        [
          {
            id: "iws_slack_test",
            targetKey: "slack-default",
            integrationConnectionId: SlackConnectionId,
            displayName: "Slack Events API webhook",
            endpointKey: "ep_slack_test",
            status: "active",
            providerMetadata: createStoryWebhookTriggerCapabilitiesProviderMetadata({
              definition: SlackBrowserDefinition,
              events: ["app_mention"],
              permissions: [{ permission: "app_mentions:read" }],
            }),
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-08T00:00:00.000Z",
          },
        ],
      );
    }
  }

  queryClient.setQueryData(
    AUTOMATION_SANDBOX_PROFILES_QUERY_KEY,
    input.seedSlackProfile === true
      ? [
          {
            value: SandboxProfileId,
            label: "Slack profile",
          },
        ]
      : [],
  );
  if (input.seedSlackProfile === true) {
    queryClient.setQueryData(sandboxProfileVersionsQueryKey(SandboxProfileId), {
      versions: [
        {
          sandboxProfileId: SandboxProfileId,
          version: 1,
          state: "published",
          isActive: true,
          publishedAt: "2026-05-01T00:00:00.000Z",
          defaultPersistenceMode: "ephemeral",
          sandboxProvider: null,
          sandboxConnectionId: null,
          sandboxVcpuCount: null,
          sandboxMemoryMb: null,
          sandboxStorageMb: null,
          snapshotImageProvider: null,
          snapshotImageId: null,
          latestSnapshotJob: null,
          refreshSchedule: null,
        },
      ],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: SandboxProfileId,
        version: 1,
      }),
      {
        repositoryOptions: [],
        bindings: [
          {
            id: "bnd_slack_test",
            sandboxProfileId: SandboxProfileId,
            sandboxProfileVersion: 1,
            connectionId: SlackConnectionId,
            kind: "connector",
            config: {},
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-08T00:00:00.000Z",
          },
        ],
      },
    );
  }

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

function getFormControlValue(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }

  throw new Error("Expected an input or textarea form control.");
}

describe("AutomationCreatePage", () => {
  it("starts without a selected trigger source", () => {
    renderCreatePage({ initialEntry: "/automations/new" });

    expect(screen.getByRole("region", { name: "Create trigger page" }).getAttribute("style")).toBe(
      "scrollbar-gutter: stable;",
    );
    expect(screen.getByRole("heading", { name: "Create trigger" })).toBeDefined();
    expect(screen.getByText("Trigger source")).toBeDefined();
    expect(screen.getByText("Select source")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "When this happens" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "When this runs" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "User message" })).toBeNull();
  });

  it("orders the create form fields by profile, type, and name", () => {
    renderCreatePage({ initialEntry: "/automations/new" });

    const sandboxProfileLabel = screen.getByText("Sandbox profile");
    const automationTypeLabel = screen.getByText("Trigger source");
    const automationNameLabel = screen.getByText("Trigger name");

    expect(sandboxProfileLabel.compareDocumentPosition(automationTypeLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(automationTypeLabel.compareDocumentPosition(automationNameLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("ignores type query values when choosing the initial trigger source", () => {
    renderCreatePage({ initialEntry: "/automations/new?type=event" });

    expect(screen.getByRole("heading", { name: "Create trigger" })).toBeDefined();
    expect(screen.getByText("Trigger source")).toBeDefined();
    expect(screen.getByText("Select source")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "When this happens" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "When this runs" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "User message" })).toBeNull();
  });

  it("prefills the create form from a hardcoded trigger template", () => {
    renderCreatePage({ initialEntry: "/automations/new?template=slack-app-mention" });

    expect(screen.getByText("Event")).toBeDefined();
    expect(getFormControlValue(screen.getByRole("textbox", { name: "Trigger name" }))).toBe(
      "Slack Mention",
    );
    expect(screen.getByRole("textbox", { name: "User message" }).textContent).toContain(
      "{{payload.event}}",
    );
  });

  it("selects the template event after profile bindings are available", async () => {
    renderCreatePage({
      initialEntry: `/automations/new?sandboxProfileId=${SandboxProfileId}&template=slack-app-mention`,
      seedSlackProfile: true,
    });

    await waitFor(() => {
      expect(screen.getByText("App mention")).toBeDefined();
    });
  });

  it("requires the user to select a trigger source before creating", () => {
    renderCreatePage({ initialEntry: "/automations/new" });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByText("Select a trigger source.")).toBeDefined();
    expect(screen.getByText("Please address the fields highlighted in red.")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "When this happens" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "User message" })).toBeNull();
  });
});
