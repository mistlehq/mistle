// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  resolveSelectedProfileTriggerState,
  useLoadedWebhookAutomationEditorState,
} from "./use-webhook-automation-editor-state.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";

function createDirectoryData(input?: {
  supportedWebhookEvents?: {
    eventType: string;
    providerEventType: string;
    displayName: string;
  }[];
}) {
  return {
    connections: [
      {
        id: "conn_linear",
        targetKey: "linear-cloud",
        displayName: "Linear Workspace",
        status: "active" as const,
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
        supportedWebhookEvents: input?.supportedWebhookEvents ?? [],
        targetHealth: {
          configStatus: "valid" as const,
        },
      },
    ],
  };
}

function createBinding() {
  return {
    id: "bnd_linear",
    sandboxProfileId: "sbp_123",
    sandboxProfileVersion: 1,
    connectionId: "conn_linear",
    kind: "connector" as const,
    config: {},
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
        bindings: [createBinding()],
        directoryData: createDirectoryData(),
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
        directoryData: createDirectoryData(),
      }).disabledReason,
    ).toBe("Could not load profile bindings.");
  });

  it("preserves selected triggers when the sandbox profile changes", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    const triggerId = createWebhookAutomationTriggerId({
      connectionId: "conn_linear",
      eventType: "linear.issue.created",
    });

    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_456"), {
      versions: [{ sandboxProfileId: "sbp_456", version: 1 }],
    });
    queryClient.setQueryData(
      sandboxProfileVersionIntegrationBindingsQueryKey({
        profileId: "sbp_456",
        version: 1,
      }),
      {
        bindings: [],
      },
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "create",
          automationId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Linear automation",
            sandboxProfileId: "",
            enabled: true,
            instructions: "Watch for new Linear issues.",
            conversationKeyTemplate: "{{payload.team.id}}",
            triggerIds: [triggerId],
            triggerParameterValues: {
              [triggerId]: {
                team: "eng",
              },
            },
          },
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: createDirectoryData({
            supportedWebhookEvents: [
              {
                eventType: "linear.issue.created",
                providerEventType: "Issue",
                displayName: "Issue created",
              },
            ],
          }),
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    act(() => {
      result.current.onValueChange("sandboxProfileId", "sbp_456");
    });

    expect(result.current.values.triggerIds).toEqual([triggerId]);
    expect(result.current.values.triggerParameterValues).toEqual({
      [triggerId]: {
        team: "eng",
      },
    });
  });

  it("shows a required-fields summary on submit when basic required fields are missing", () => {
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
            name: "",
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

    act(() => {
      result.current.onSubmit();
    });

    expect(result.current.validationSummaryError).toBe(
      "Please address the fields highlighted in red.",
    );
    expect(result.current.formError).toBeNull();
    expect(result.current.fieldErrors).toMatchObject({
      name: "Automation name is required.",
      sandboxProfileId: "Select a sandbox profile.",
      instructions: "Instructions are required.",
      triggerIds: "Select at least one trigger.",
    });
  });
});
