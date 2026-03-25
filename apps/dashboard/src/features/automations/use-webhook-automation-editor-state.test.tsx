// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAutomationApplicableSandboxProfileFixture } from "../../test-support/automations.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  resolveWebhookAutomationEditorPresentationMode,
  resolveSelectedProfileTriggerState,
  resolveWebhookAutomationReconfigureInitialValues,
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

  it("enters view mode for stale edit profiles until reconfiguration starts", () => {
    expect(
      resolveWebhookAutomationEditorPresentationMode({
        mode: "edit",
        isReconfiguring: false,
        selectedProfileId: "sbp_stale",
        automationApplicableSandboxProfiles: [],
      }),
    ).toEqual({
      kind: "view",
      reason: "stale_profile",
    });
  });

  it("returns to editable mode when reconfiguring a stale automation", () => {
    expect(
      resolveWebhookAutomationEditorPresentationMode({
        mode: "edit",
        isReconfiguring: true,
        selectedProfileId: "sbp_stale",
        automationApplicableSandboxProfiles: [],
      }),
    ).toEqual({
      kind: "editable",
    });
  });

  it("clears stale profile and trigger selections when reconfiguring", () => {
    expect(
      resolveWebhookAutomationReconfigureInitialValues({
        name: "Your automation",
        sandboxProfileId: "sbp_stale",
        enabled: true,
        instructions: "Keep this",
        conversationKeyTemplate: "{{payload.id}}",
        triggerIds: ["conn_123::github.push"],
        triggerParameterValues: {
          "conn_123::github.push": {
            repository: "mistlehq/mistle",
          },
        },
      }),
    ).toEqual({
      name: "Your automation",
      sandboxProfileId: "",
      enabled: true,
      instructions: "Keep this",
      conversationKeyTemplate: "",
      triggerIds: [],
      triggerParameterValues: {},
    });
  });
});
