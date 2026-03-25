// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAutomationApplicableSandboxProfileFixture } from "../../test-support/automations.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  resolveSelectedProfileTriggerState,
  useLoadedWebhookAutomationEditorState,
} from "./use-webhook-automation-editor-state.js";

describe("useLoadedWebhookAutomationEditorState", () => {
  it("renders in create mode with loaded prerequisites", () => {
    const queryClient = createTestQueryClient({
      staleTime: Number.POSITIVE_INFINITY,
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
        selectedProfile: createAutomationApplicableSandboxProfileFixture({
          displayName: "Support Agent",
          latestVersion: 3,
          createdAt: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-24T00:00:00.000Z",
          eligibleIntegrationConnectionIds: [],
        }),
      }).disabledReason,
    ).toBe("The selected profile has no bindings with automation triggers.");
  });

  it("enables trigger selection when the selected profile exposes eligible connections", () => {
    expect(
      resolveSelectedProfileTriggerState({
        selectedProfile: createAutomationApplicableSandboxProfileFixture({
          displayName: "Support Agent",
          latestVersion: 3,
          createdAt: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-24T00:00:00.000Z",
          eligibleIntegrationConnectionIds: ["conn_linear"],
        }),
      }),
    ).toEqual({
      disabledReason: null,
      eligibleConnectionIds: ["conn_linear"],
    });
  });
});
