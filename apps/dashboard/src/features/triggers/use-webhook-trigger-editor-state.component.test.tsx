// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  sandboxProfileVersionTriggerConfigQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  resolveSelectedProfileTriggerState,
  useLoadedWebhookTriggerEditorState,
} from "./use-webhook-trigger-editor-state.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";
import {
  createWebhookTriggerEventId,
  WebhookTriggerWorkspaceRootRepositoryOptionValue,
} from "./webhook-trigger-option-builders.js";

const LinearConnectionId = "conn_linear";
const LinearWebhookSourceId = "iws_linear";

function isRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS,
    value,
  };
}

function containsTokenRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN,
    value,
  };
}

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
        kind: "connector" as const,
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

function createTriggerConfig(input?: {
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

describe("useLoadedWebhookTriggerEditorState", () => {
  it("renders in create mode with loaded prerequisites", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });

    const { result } = renderHook(
      () =>
        useLoadedWebhookTriggerEditorState({
          mode: "create",
          triggerId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Your trigger",
            sandboxProfileId: "",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
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
      name: "Your trigger",
      sandboxProfileId: "",
      primaryRepositoryId: "",
      enabled: true,
      inputTemplate: "",
      instructions: "",
      conversationKeyTemplate: "",
      eventIds: [],
      eventParameterRules: {},
    });
    expect(result.current.formError).toBeNull();
    expect(result.current.triggerPickerDisabledState).toEqual({
      reason: "Select a sandbox profile to choose events.",
      variant: "default",
    });
  });

  it("marks profiles without trigger-capable bindings as unavailable for triggers", () => {
    expect(
      resolveSelectedProfileTriggerState({
        selectedProfileId: "sbp_123",
        selectedProfileName: "Repo Maintainer",
        hasActiveProfileVersion: true,
        hasBindingData: true,
        isBindingDataPending: false,
        bindingErrorMessage: null,
        bindings: [createBinding()],
        directoryData: createDirectoryData(),
      }).disabledState,
    ).toEqual({
      reason:
        "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
      variant: "default",
    });
  });

  it("uses the referenced profile version in edit-mode trigger availability copy", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      createTriggerConfig({ bindings: [] }),
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookTriggerEditorState({
          mode: "edit",
          triggerId: "atm_123",
          navigate: async () => {},
          initialSandboxProfileVersion: 1,
          initialValues: {
            name: "Linear trigger",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
          },
          connectionOptions: [],
          sandboxProfileOptions: [
            {
              value: "sbp_123",
              label: "Repo Maintainer v3",
              sandboxProfileDisplayName: "Repo Maintainer",
              sandboxProfileVersion: 3,
            },
          ],
          directoryData: createDirectoryData(),
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    expect(result.current.sandboxProfileOptions[0]?.label).toBe("Repo Maintainer v1");
    expect(result.current.triggerPickerDisabledState).toEqual({
      reason:
        "The sandbox profile Repo Maintainer v1 has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
      variant: "default",
    });
  });

  it("surfaces binding query failures instead of showing a loading state", () => {
    expect(
      resolveSelectedProfileTriggerState({
        selectedProfileId: "sbp_123",
        hasActiveProfileVersion: null,
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

  it("marks profiles without an active version as unavailable for triggers", () => {
    expect(
      resolveSelectedProfileTriggerState({
        selectedProfileId: "sbp_123",
        selectedProfileName: "Repo Maintainer",
        hasActiveProfileVersion: false,
        hasBindingData: false,
        isBindingDataPending: false,
        bindingErrorMessage: null,
        bindings: [],
        directoryData: createDirectoryData(),
      }).disabledState,
    ).toEqual({
      reason: "Select a sandbox profile with an active version to choose events.",
      variant: "default",
    });
  });

  it("shows the sandbox profile status message when the selected profile has no active version", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [
        createSandboxProfileVersion({
          sandboxProfileId: "sbp_123",
          version: 1,
          isActive: false,
          state: "draft",
        }),
      ],
    });

    const { result } = renderHook(
      () =>
        useLoadedWebhookTriggerEditorState({
          mode: "create",
          triggerId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Linear trigger",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
          },
          connectionOptions: [],
          sandboxProfileOptions: [
            {
              value: "sbp_123",
              label: "Repo Maintainer",
            },
          ],
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

    expect(result.current.sandboxProfileStatusMessage).toEqual({
      message:
        "The sandbox profile Repo Maintainer has no active version. Publish the profile before creating triggers.",
      variant: "alert",
    });
    expect(result.current.triggerPickerDisabledState).toEqual({
      reason: "Select a sandbox profile with an active version to choose events.",
      variant: "default",
    });

    act(() => {
      result.current.onSubmit();
    });

    expect(result.current.fieldErrors.sandboxProfileId).toBe(
      "The sandbox profile Repo Maintainer has no active version. Publish the profile before creating triggers.",
    );
  });

  it("preserves selected triggers when the sandbox profile changes", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue.created",
    });

    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_456"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_456", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_456",
        version: 1,
      }),
      createTriggerConfig({ repositoryIds: [] }),
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookTriggerEditorState({
          mode: "create",
          triggerId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Linear trigger",
            sandboxProfileId: "",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "Watch for new Linear issues.",
            instructions: "",
            conversationKeyTemplate: "{{payload.team.id}}",
            eventIds: [triggerId],
            eventParameterRules: {
              [triggerId]: {
                team: isRule("eng"),
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

    expect(result.current.values.eventIds).toEqual([triggerId]);
    expect(result.current.values.eventParameterRules).toEqual({
      [triggerId]: {
        team: isRule("eng"),
      },
    });
  });

  it("defaults the primary repository selection to workspace root for the selected profile version", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_123", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      createTriggerConfig(),
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookTriggerEditorState({
          mode: "create",
          triggerId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Linear trigger",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
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
      WebhookTriggerWorkspaceRootRepositoryOptionValue,
    );
    expect(result.current.primaryRepositoryOptions.map((option) => option.value)).toEqual([
      WebhookTriggerWorkspaceRootRepositoryOptionValue,
      "mistlehq/platform",
    ]);
  });

  it("clears the prior primary repository selection when the sandbox profile changes", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_123", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      createTriggerConfig({
        bindings: [createBinding()],
      }),
    );
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_456"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_456", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_456",
        version: 1,
      }),
      createTriggerConfig({
        repositoryIds: ["mistlehq/mistle"],
      }),
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookTriggerEditorState({
          mode: "create",
          triggerId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Linear trigger",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "mistlehq/platform",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
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
      WebhookTriggerWorkspaceRootRepositoryOptionValue,
    );
    expect(result.current.primaryRepositoryOptions.map((option) => option.value)).toEqual([
      WebhookTriggerWorkspaceRootRepositoryOptionValue,
      "mistlehq/mistle",
    ]);
  });

  it("uses the pinned sandbox profile version when hydrating repository options in edit mode", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      createTriggerConfig({
        repositoryIds: ["mistlehq/platform"],
      }),
    );
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_123",
        version: 2,
      }),
      createTriggerConfig({
        repositoryIds: ["mistlehq/mistle"],
      }),
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookTriggerEditorState({
          mode: "edit",
          triggerId: "atm_123",
          navigate: async () => {},
          initialValues: {
            name: "Pinned trigger",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "mistlehq/platform",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
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
      WebhookTriggerWorkspaceRootRepositoryOptionValue,
      "mistlehq/platform",
    ]);
  });

  it("uses the active-version trigger config after the profile changes in edit mode", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_123",
        version: 1,
      }),
      createTriggerConfig({
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
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_456",
        version: 1,
      }),
      createTriggerConfig({
        repositoryIds: ["mistlehq/platform"],
        bindings: [createBinding()],
      }),
    );
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_456",
        version: 2,
      }),
      createTriggerConfig({
        repositoryIds: ["mistlehq/mistle"],
        bindings: [createBinding()],
      }),
    );

    const { result } = renderHook(
      () =>
        useLoadedWebhookTriggerEditorState({
          mode: "edit",
          triggerId: "atm_123",
          navigate: async () => {},
          initialValues: {
            name: "Pinned trigger",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "mistlehq/platform",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
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
      WebhookTriggerWorkspaceRootRepositoryOptionValue,
    );
    expect(result.current.primaryRepositoryOptions.map((option) => option.value)).toEqual([
      WebhookTriggerWorkspaceRootRepositoryOptionValue,
      "mistlehq/platform",
    ]);
  });

  it("does not apply invocation token defaults when a trigger is selected", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue_comment.created",
    });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_123", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
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
        useLoadedWebhookTriggerEditorState({
          mode: "create",
          triggerId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Linear trigger",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
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
      result.current.onValueChange("eventIds", [triggerId]);
    });

    expect(result.current.values.eventParameterRules).toEqual({
      [triggerId]: {},
    });
  });

  it("preserves explicit invocation opt-out when trigger selections change", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const firstTriggerId = createWebhookTriggerEventId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue_comment.created",
    });
    const secondTriggerId = createWebhookTriggerEventId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue.opened",
    });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_123", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
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
        useLoadedWebhookTriggerEditorState({
          mode: "create",
          triggerId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Linear trigger",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
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
      result.current.onValueChange("eventIds", [firstTriggerId]);
    });

    act(() => {
      result.current.onValueChange("eventParameterRules", {
        ...result.current.values.eventParameterRules,
        [firstTriggerId]: {
          invocationToken: containsTokenRule(""),
        },
      });
    });

    act(() => {
      result.current.onValueChange("eventIds", [firstTriggerId, secondTriggerId]);
    });

    expect(result.current.values.eventParameterRules).toEqual({
      [firstTriggerId]: {
        invocationToken: containsTokenRule(""),
      },
      [secondTriggerId]: {},
    });
  });

  it("does not auto-enable explicit invocation when editing an existing trigger", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const firstTriggerId = createWebhookTriggerEventId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue_comment.created",
    });
    const secondTriggerId = createWebhookTriggerEventId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue.opened",
    });
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_123"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_123", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
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
        useLoadedWebhookTriggerEditorState({
          mode: "edit",
          triggerId: "atm_123",
          navigate: async () => {},
          initialValues: {
            name: "Existing trigger",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [firstTriggerId],
            eventParameterRules: {
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
      result.current.onValueChange("eventIds", [firstTriggerId, secondTriggerId]);
    });

    expect(result.current.values.eventParameterRules).toEqual({
      [firstTriggerId]: {},
      [secondTriggerId]: {},
    });
  });

  it("shows a required-fields summary on submit when basic required fields are missing", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });

    const { result } = renderHook(
      () =>
        useLoadedWebhookTriggerEditorState({
          mode: "create",
          triggerId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "",
            sandboxProfileId: "",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
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
      name: "Trigger name is required.",
      sandboxProfileId: "Select a sandbox profile.",
      inputTemplate: "User message is required.",
      eventIds: "Please add an event",
    });
  });

  it("shows a required-fields summary when the only missing field is triggers", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });

    const { result } = renderHook(
      () =>
        useLoadedWebhookTriggerEditorState({
          mode: "create",
          triggerId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "GitHub triage",
            sandboxProfileId: "sbp_123",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [],
            eventParameterRules: {},
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
    expect(result.current.fieldErrors.eventIds).toBe("Please add an event");
  });

  it("clears stale trigger validation errors when the sandbox profile changes", () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: LinearWebhookSourceId,
      eventType: "linear.issue.created",
    });

    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_invalid"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_invalid", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
        profileId: "sbp_invalid",
        version: 1,
      }),
      createTriggerConfig({ repositoryIds: [] }),
    );
    queryClient.setQueryData(sandboxProfileVersionsQueryKey("sbp_valid"), {
      versions: [createSandboxProfileVersion({ sandboxProfileId: "sbp_valid", version: 1 })],
    });
    queryClient.setQueryData(
      sandboxProfileVersionTriggerConfigQueryKey({
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
        useLoadedWebhookTriggerEditorState({
          mode: "create",
          triggerId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "Linear trigger",
            sandboxProfileId: "sbp_invalid",
            primaryRepositoryId: "",
            enabled: true,
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
            eventIds: [triggerId],
            eventParameterRules: {},
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

    expect(result.current.fieldErrors.eventIds).toBe(
      "Event is unavailable for the selected sandbox profile.",
    );

    act(() => {
      result.current.onValueChange("sandboxProfileId", "sbp_valid");
    });

    expect(result.current.fieldErrors.eventIds).toBeUndefined();
    expect(result.current.validationSummaryError).toBeNull();
  });
});
