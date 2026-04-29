// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  sandboxProfileVersionAutomationConfigQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  resolveSelectedProfileTriggerState,
  useLoadedWebhookAutomationEditorState,
} from "./use-webhook-automation-editor-state.js";
import {
  createWebhookAutomationTriggerId,
  WebhookAutomationWorkspaceRootRepositoryOptionValue,
} from "./webhook-automation-option-builders.js";

const LinearConnectionId = "conn_linear";
const LinearWebhookSourceId = "iws_linear";

function createInvocationTokenParameter(payloadPath: string[]) {
  return {
    id: "invocationToken",
    label: "invocation token",
    kind: "string" as const,
    payloadPath,
    matchMode: "contains_token" as const,
    controlVariant: "invocation-token" as const,
  };
}

function createDirectoryData(input?: {
  supportedWebhookEvents?: {
    eventType: string;
    providerEventType: string;
    displayName: string;
    parameters?: Array<{
      id: string;
      label: string;
      kind: "string";
      payloadPath: string[];
      matchMode?: "eq" | "contains" | "contains_token";
      controlVariant?: "invocation-token";
    }>;
  }[];
}) {
  return {
    connections: [
      {
        id: LinearConnectionId,
        targetKey: "linear-cloud",
        displayName: "Linear Workspace",
        status: "active" as const,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
    ],
    webhookSources: [
      {
        id: LinearWebhookSourceId,
        targetKey: "linear-cloud",
        integrationConnectionId: LinearConnectionId,
        displayName: "Linear Workspace webhook",
        endpointKey: "ep_linear",
        callbackUrl:
          "https://control-plane.example.com/p/integration/webhooks/linear-cloud/ep_linear",
        remoteRegistrationId: "whk_linear",
        status: "active" as const,
        providerMetadata: {},
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
    connectionId: LinearConnectionId,
    kind: "connector" as const,
    config: {},
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
  };
}

function createAutomationConfig(input?: {
  repositoryIds?: readonly string[];
  bindings?: ReturnType<typeof createBinding>[];
}) {
  const repositoryIds = input?.repositoryIds ?? ["mistlehq/platform"];

  return {
    bindings: input?.bindings ?? [],
    repositoryOptions: repositoryIds.map((repositoryId) => ({
      id: repositoryId,
      label: repositoryId,
      path: `/root/${repositoryId}`,
    })),
  };
}

function createSandboxProfileVersion(input: {
  sandboxProfileId: string;
  version: number;
  isActive?: boolean;
  state?: "draft" | "published";
}) {
  const state = input.state ?? "published";

  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    state,
    isActive: input.isActive ?? true,
    usable: state === "published",
    latestSnapshotJob: null,
    refreshSchedule: null,
  };
}

describe("useLoadedWebhookAutomationEditorState", () => {
  it("renders in create mode with loaded prerequisites", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "create",
          automationId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Your automation",
            sandboxProfileId: "",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: {
            connections: [],
            webhookSources: [],
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
      primaryRepositoryId: "",
      enabled: true,
      inputTemplate: "",
      instructions: "",
      conversationKeyTemplate: "",
      triggerIds: [],
      triggerParameterValues: {},
    });
    expect(result.current.formError).toBeNull();
    expect(result.current.triggerPickerDisabledState).toEqual({
      reason: "Select a sandbox profile to choose triggers.",
      variant: "default",
    });
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
      }).disabledState,
    ).toEqual({
      reason: "The selected profile has no bindings with automation triggers.",
      variant: "default",
    });
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
      }).disabledState,
    ).toEqual({
      reason: "Could not load profile bindings.",
      variant: "alert",
    });
  });

  it("preserves selected triggers when the sandbox profile changes", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const triggerId = createWebhookAutomationTriggerId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue.created",
    });

    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_456"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_456", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_456",
        version: 1,
      }),
      createAutomationConfig({ repositoryIds: [] }),
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
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "Watch for new Linear issues.",
            instructions: "",
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

  it("defaults the primary repository selection to workspace root for the selected profile version", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_123", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      createAutomationConfig(),
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "create",
          automationId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Linear automation",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: {
            connections: [],
            webhookSources: [],
            targets: [],
          },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    expect(result.current.values.primaryRepositoryId).toBe(
      WebhookAutomationWorkspaceRootRepositoryOptionValue,
    );
    expect(result.current.primaryRepositoryOptions.map((option) => option.value)).toEqual([
      WebhookAutomationWorkspaceRootRepositoryOptionValue,
      "mistlehq/platform",
    ]);
  });

  it("clears the prior primary repository selection when the sandbox profile changes", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_123", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      createAutomationConfig({
        bindings: [createBinding()],
      }),
    );
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_456"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_456", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_456",
        version: 1,
      }),
      createAutomationConfig({
        repositoryIds: ["mistlehq/mistle"],
      }),
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "create",
          automationId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Linear automation",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "mistlehq/platform",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: {
            connections: [],
            webhookSources: [],
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
      result.current.onValueChange("sandboxProfileId", "sbp_456");
    });

    expect(result.current.values.primaryRepositoryId).toBe(
      WebhookAutomationWorkspaceRootRepositoryOptionValue,
    );
    expect(result.current.primaryRepositoryOptions.map((option) => option.value)).toEqual([
      WebhookAutomationWorkspaceRootRepositoryOptionValue,
      "mistlehq/mistle",
    ]);
  });

  it("uses the pinned sandbox profile version when hydrating repository options in edit mode", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      createAutomationConfig({
        repositoryIds: ["mistlehq/platform"],
      }),
    );
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_123",
        version: 2,
      }),
      createAutomationConfig({
        repositoryIds: ["mistlehq/mistle"],
      }),
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "edit",
          automationId: "atm_123",
          navigate: async () => {},
          initialValues: {
            name: "Pinned automation",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "mistlehq/platform",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          initialSandboxProfileVersion: 1,
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: {
            connections: [],
            webhookSources: [],
            targets: [],
          },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    expect(result.current.values.primaryRepositoryId).toBe("mistlehq/platform");
    expect(result.current.primaryRepositoryOptions.map((option) => option.value)).toEqual([
      WebhookAutomationWorkspaceRootRepositoryOptionValue,
      "mistlehq/platform",
    ]);
  });

  it("uses the active-version automation config after the profile changes in edit mode", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      createAutomationConfig({
        bindings: [createBinding()],
      }),
    );
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_456"), {
      versions: [
        createSandboxProfileVersion({
          sandboxProfileId: "sbp_456",
          version: 1,
          isActive: true,
        }),
        createSandboxProfileVersion({
          sandboxProfileId: "sbp_456",
          version: 2,
          isActive: false,
          state: "draft",
        }),
      ],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_456",
        version: 1,
      }),
      createAutomationConfig({
        repositoryIds: ["mistlehq/platform"],
        bindings: [createBinding()],
      }),
    );
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_456",
        version: 2,
      }),
      createAutomationConfig({
        repositoryIds: ["mistlehq/mistle"],
        bindings: [createBinding()],
      }),
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "edit",
          automationId: "atm_123",
          navigate: async () => {},
          initialValues: {
            name: "Pinned automation",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "mistlehq/platform",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          initialSandboxProfileVersion: 1,
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: {
            connections: [],
            webhookSources: [],
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
      result.current.onValueChange("sandboxProfileId", "sbp_456");
    });

    expect(result.current.values.primaryRepositoryId).toBe(
      WebhookAutomationWorkspaceRootRepositoryOptionValue,
    );
    expect(result.current.primaryRepositoryOptions.map((option) => option.value)).toEqual([
      WebhookAutomationWorkspaceRootRepositoryOptionValue,
      "mistlehq/platform",
    ]);
  });

  it("does not apply invocation token defaults when a trigger is selected", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const triggerId = createWebhookAutomationTriggerId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue_comment.created",
    });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_123", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      {
        bindings: [createBinding()],
        repositoryOptions: [],
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
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: createDirectoryData({
            supportedWebhookEvents: [
              {
                eventType: "linear.issue_comment.created",
                providerEventType: "IssueComment",
                displayName: "Issue comment created",
                parameters: [createInvocationTokenParameter(["comment", "body"])],
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
      result.current.onValueChange("triggerIds", [triggerId]);
    });

    expect(result.current.values.triggerParameterValues).toEqual({
      [triggerId]: {},
    });
  });

  it("preserves explicit invocation opt-out when trigger selections change", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const firstTriggerId = createWebhookAutomationTriggerId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue_comment.created",
    });
    const secondTriggerId = createWebhookAutomationTriggerId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue.opened",
    });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_123", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      {
        bindings: [createBinding()],
        repositoryOptions: [],
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
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: createDirectoryData({
            supportedWebhookEvents: [
              {
                eventType: "linear.issue_comment.created",
                providerEventType: "IssueComment",
                displayName: "Issue comment created",
                parameters: [createInvocationTokenParameter(["comment", "body"])],
              },
              {
                eventType: "linear.issue.opened",
                providerEventType: "Issue",
                displayName: "Issue opened",
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
      result.current.onValueChange("triggerIds", [firstTriggerId]);
    });

    act(() => {
      result.current.onValueChange("triggerParameterValues", {
        ...result.current.values.triggerParameterValues,
        [firstTriggerId]: {
          invocationToken: "",
        },
      });
    });

    act(() => {
      result.current.onValueChange("triggerIds", [firstTriggerId, secondTriggerId]);
    });

    expect(result.current.values.triggerParameterValues).toEqual({
      [firstTriggerId]: {
        invocationToken: "",
      },
      [secondTriggerId]: {},
    });
  });

  it("does not auto-enable explicit invocation when editing an existing automation", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const firstTriggerId = createWebhookAutomationTriggerId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue_comment.created",
    });
    const secondTriggerId = createWebhookAutomationTriggerId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue.opened",
    });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_123", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      {
        bindings: [createBinding()],
        repositoryOptions: [],
      },
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "edit",
          automationId: "atm_123",
          navigate: async () => {},
          initialValues: {
            name: "Existing automation",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [firstTriggerId],
            triggerParameterValues: {
              [firstTriggerId]: {},
            },
          },
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: createDirectoryData({
            supportedWebhookEvents: [
              {
                eventType: "linear.issue_comment.created",
                providerEventType: "IssueComment",
                displayName: "Issue comment created",
                parameters: [createInvocationTokenParameter(["comment", "body"])],
              },
              {
                eventType: "linear.issue.opened",
                providerEventType: "Issue",
                displayName: "Issue opened",
                parameters: [createInvocationTokenParameter(["issue", "body"])],
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
      result.current.onValueChange("triggerIds", [firstTriggerId, secondTriggerId]);
    });

    expect(result.current.values.triggerParameterValues).toEqual({
      [firstTriggerId]: {},
      [secondTriggerId]: {},
    });
  });

  it("shows a required-fields summary on submit when basic required fields are missing", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "create",
          automationId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "",
            sandboxProfileId: "",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: {
            connections: [],
            webhookSources: [],
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
      inputTemplate: "Input template is required.",
      triggerIds: "Please add a trigger",
    });
  });

  it("shows a required-fields summary when the only missing field is triggers", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "create",
          automationId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "GitHub triage",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: {
            connections: [],
            webhookSources: [],
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
    expect(result.current.fieldErrors.triggerIds).toBe("Please add a trigger");
  });

  it("clears stale trigger validation errors when the sandbox profile changes", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const triggerId = createWebhookAutomationTriggerId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue.created",
    });

    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_invalid"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_invalid", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_invalid",
        version: 1,
      }),
      createAutomationConfig({ repositoryIds: [] }),
    );
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_valid"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_valid", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionAutomationConfigQueryKey({
        profileId: "sbp_valid",
        version: 1,
      }),
      {
        bindings: [createBinding()],
        repositoryOptions: [],
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
            sandboxProfileId: "sbp_invalid",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [triggerId],
            triggerParameterValues: {},
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
      result.current.onSubmit();
    });

    expect(result.current.fieldErrors.triggerIds).toBe(
      "Trigger is unavailable for the selected sandbox profile.",
    );

    act(() => {
      result.current.onValueChange("sandboxProfileId", "sbp_valid");
    });

    expect(result.current.fieldErrors.triggerIds).toBeUndefined();
    expect(result.current.validationSummaryError).toBeNull();
  });
});
