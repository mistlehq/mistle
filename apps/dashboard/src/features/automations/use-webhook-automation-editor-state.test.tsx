// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  resolveSelectedProfileTriggerState,
  useLoadedWebhookAutomationEditorState,
} from "./use-webhook-automation-editor-state.js";

function createAutomationApplicableProfile(input?: {
  eligibleIntegrationConnectionIds?: string[];
}) {
  return {
    id: "sbp_123",
    organizationId: "org_123",
    displayName: "Support Agent",
    status: "active" as const,
    latestVersion: 3,
    eligibleIntegrationConnectionIds: input?.eligibleIntegrationConnectionIds ?? [],
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
  };
}

describe("useLoadedWebhookAutomationEditorState", () => {
  it("renders in create mode with loaded prerequisites", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "create",
          automationId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Your automation",
            sandboxProfileId: "",
            enabled: true,
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          connectionOptions: [],
          sandboxProfileOptions: [],
          automationApplicableSandboxProfiles: [],
          directoryData: {
            connections: [],
            targets: [],
          },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    expect(result.current.values).toEqual({
      name: "Your automation",
      sandboxProfileId: "",
      enabled: true,
      instructions: "",
      conversationKeyTemplate: "",
      triggerIds: [],
      triggerParameterValues: {},
    });
    expect(result.current.formError).toBeNull();
    expect(result.current.triggerPickerDisabledReason).toBe(
      "Select a sandbox profile to choose triggers.",
    );
  });

  it("marks profiles without trigger-capable bindings as unavailable for automations", () => {
    expect(
      resolveSelectedProfileTriggerState({
        selectedProfile: createAutomationApplicableProfile(),
      }).disabledReason,
    ).toBe("The selected profile has no bindings with automation triggers.");
  });

  it("enables trigger selection when the selected profile exposes eligible connections", () => {
    expect(
      resolveSelectedProfileTriggerState({
        selectedProfile: createAutomationApplicableProfile({
          eligibleIntegrationConnectionIds: ["conn_linear"],
        }),
      }),
    ).toEqual({
      disabledReason: null,
      eligibleConnectionIds: ["conn_linear"],
    });
  });
});
