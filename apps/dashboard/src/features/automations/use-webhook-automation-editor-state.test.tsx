// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  resolveSelectedProfileTriggerState,
  useLoadedWebhookAutomationEditorState,
} from "./use-webhook-automation-editor-state.js";

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
        selectedProfileId: "sbp_123",
        hasBindingData: true,
        isBindingDataPending: false,
        bindingErrorMessage: null,
        bindings: [
          {
            id: "bnd_linear",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: 1,
            connectionId: "conn_linear",
            kind: "connector",
            config: {},
            createdAt: "2026-03-24T00:00:00.000Z",
            updatedAt: "2026-03-24T00:00:00.000Z",
          },
        ],
        directoryData: {
          connections: [
            {
              id: "conn_linear",
              targetKey: "linear-cloud",
              displayName: "Linear Workspace",
              status: "active",
              createdAt: "2026-03-24T00:00:00.000Z",
              updatedAt: "2026-03-24T00:00:00.000Z",
            },
          ],
          targets: [
            {
              targetKey: "linear-cloud",
              familyId: "linear",
              variantId: "linear-default",
              enabled: true,
              config: {},
              displayName: "Linear",
              description: "Linear Cloud",
              supportedWebhookEvents: [],
              targetHealth: {
                configStatus: "valid",
              },
            },
          ],
        },
      }).disabledReason,
    ).toBe("The selected profile has no bindings with automation triggers.");
  });

  it("surfaces binding query failures instead of showing a loading state", () => {
    expect(
      resolveSelectedProfileTriggerState({
        selectedProfileId: "sbp_123",
        hasBindingData: false,
        isBindingDataPending: false,
        bindingErrorMessage: "Could not load profile bindings.",
        bindings: [],
        directoryData: {
          connections: [],
          targets: [],
        },
      }).disabledReason,
    ).toBe("Could not load profile bindings.");
  });
});
