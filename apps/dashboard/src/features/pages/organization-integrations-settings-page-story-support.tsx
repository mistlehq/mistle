import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import {
  createBrowserIntegrationRegistry,
  listBrowserIntegrationDefinitions,
} from "@mistle/integrations-definitions/browser";
import { useState } from "react";
import type React from "react";

import {
  IntegrationConnectionEditorPage,
  type IntegrationConnectionDeviceAuthorizationPendingState,
  type IntegrationConnectionMethodId,
} from "../integrations/integration-connection-editor.js";
import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";
import { PageFrame } from "../shared/page-frame.js";
import type { OpenIntegrationConnectionEditorInput } from "./integration-connection-editor-state-types.js";
import type { OrganizationIntegrationsSettingsPageCard } from "./organization-integrations-settings-page-view.js";
import {
  createInitialIntegrationConnectionEditorState,
  hasIntegrationConnectionEditorChanges,
  isIntegrationConnectionDisplayNameChanged,
  resolveConnectionMethodFormUiModel,
  resolveDefaultMethodId,
  resolveIntegrationConnectionEditorValidationError,
  resolveNextDraftForMethodChange,
} from "./use-integration-connection-editor-state-helpers.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
type BuiltInIntegrationVariantId =
  | "github-cloud"
  | "github-enterprise-server"
  | "jira-default"
  | "linear-default"
  | "openai-default"
  | "signoz-mcp";
type DeviceAuthorizationExpiryScenario = "active" | "expired" | "expiringSoon";

type StoryIntegrationSpec = {
  connectError?: string | null;
  deviceAuthorizationExpiryScenario?: DeviceAuthorizationExpiryScenario;
  initialDeviceAuthorizationPending?: boolean;
  initialConnectionDisplayNameValue?: string;
  initialMethodId?: IntegrationConnectionMethodId;
  initialSecrets?: Record<string, string>;
  pending?: boolean;
  startDeviceAuthorizationOnSubmit?: boolean;
  targetKey?: string;
  variantId: BuiltInIntegrationVariantId;
};

function getDefinitionOrThrow(input: {
  familyId: string;
  variantId: BuiltInIntegrationVariantId;
}): AnyIntegrationDefinition {
  const definition = IntegrationRegistry.getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });
  if (definition === null) {
    throw new Error(
      `Missing browser integration definition '${input.familyId}/${input.variantId}' for Storybook.`,
    );
  }

  if (definition === undefined) {
    throw new Error(
      `Browser integration definition '${input.familyId}/${input.variantId}' resolved to undefined.`,
    );
  }

  return definition;
}

function getStoryDefinitionOrThrow(
  variantId: BuiltInIntegrationVariantId,
): AnyIntegrationDefinition {
  if (variantId === "github-cloud" || variantId === "github-enterprise-server") {
    return getDefinitionOrThrow({
      familyId: "github",
      variantId,
    });
  }

  if (variantId === "jira-default") {
    return getDefinitionOrThrow({
      familyId: "jira",
      variantId,
    });
  }

  if (variantId === "linear-default") {
    return getDefinitionOrThrow({
      familyId: "linear",
      variantId,
    });
  }

  if (variantId === "signoz-mcp") {
    return getDefinitionOrThrow({
      familyId: "signoz",
      variantId,
    });
  }

  return getDefinitionOrThrow({
    familyId: "openai",
    variantId,
  });
}

export function createStoryConnectionMethods(
  definition: Pick<AnyIntegrationDefinition, "connectionMethods">,
): IntegrationConnectionMethod[] | undefined {
  if (definition.connectionMethods === undefined) {
    return undefined;
  }

  return definition.connectionMethods.map((method) => {
    if (method.kind === "form") {
      return {
        id: method.id,
        kind: method.kind,
        label: method.label,
        ...(method.connectionDetail === undefined
          ? {}
          : { connectionDetail: method.connectionDetail }),
        ...(method.createBehavior === undefined ? {} : { createBehavior: method.createBehavior }),
        ...(method.postCreate === undefined ? {} : { postCreate: method.postCreate }),
        ...(method.setupFlow === undefined ? {} : { setupFlow: method.setupFlow }),
        secretFields: method.secretFields.map((secretField) => ({
          description: secretField.description,
          inputType: secretField.inputType,
          label: secretField.label,
          name: secretField.name,
          placeholder: secretField.placeholder,
        })),
      };
    }

    if (method.kind === "redirect") {
      return {
        id: method.id,
        kind: "redirect",
        label: method.label,
        ui: method.ui,
      };
    }

    return {
      id: method.id,
      kind: "device-authorization",
      label: method.label,
      ui: method.ui,
    };
  });
}

function resolveConnectionMethodsOrThrow(
  definition: AnyIntegrationDefinition,
): readonly IntegrationConnectionMethod[] {
  const connectionMethods = createStoryConnectionMethods(definition);
  if (connectionMethods === undefined || connectionMethods.length === 0) {
    throw new Error(
      `Integration definition '${definition.familyId}/${definition.variantId}' has no connection methods.`,
    );
  }

  return connectionMethods;
}

function resolveDescriptionOrThrow(definition: AnyIntegrationDefinition): string {
  if (definition.description === undefined) {
    throw new Error(
      `Integration definition '${definition.familyId}/${definition.variantId}' is missing a description.`,
    );
  }

  return definition.description;
}

function createTargetConfig(variantId: BuiltInIntegrationVariantId): Record<string, unknown> {
  if (variantId === "github-cloud") {
    return {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
      app_id: "17452",
      app_slug: "mistle-cloud",
      client_id: "Iv1.cloudstorybook",
    };
  }

  if (variantId === "github-enterprise-server") {
    return {
      api_base_url: "https://github.acme.example/api/v3",
      web_base_url: "https://github.acme.example",
      app_id: "88421",
      app_slug: "mistle-ghes",
      client_id: "Iv1.ghesstorybook",
    };
  }

  if (variantId === "openai-default") {
    return {
      api_base_url: "https://api.openai.com/v1",
    };
  }

  return {};
}

function createEditorInput(
  spec: StoryIntegrationSpec,
): Extract<OpenIntegrationConnectionEditorInput, { mode: "create" }> {
  const definition = getStoryDefinitionOrThrow(spec.variantId);
  const methods = resolveConnectionMethodsOrThrow(definition);

  return {
    mode: "create",
    methods,
    targetConfig: createTargetConfig(spec.variantId),
    targetDisplayName: definition.displayName,
    targetFamilyId: definition.familyId,
    targetKey: spec.targetKey ?? definition.variantId,
    targetVariantId: definition.variantId,
  };
}

function isOpenAiDeviceAuthorizationMethod(
  method: IntegrationConnectionMethod,
): method is Extract<IntegrationConnectionMethod, { kind: "device-authorization" }> {
  return method.id === "chatgpt-device-code" && method.kind === "device-authorization";
}

function createStoryDeviceAuthorizationExpiresAt(
  scenario: DeviceAuthorizationExpiryScenario,
): string {
  const nowMs = Date.now();

  if (scenario === "active") {
    return new Date(nowMs + 11 * 60_000).toISOString();
  }

  if (scenario === "expiringSoon") {
    return new Date(nowMs + 30_000).toISOString();
  }

  return new Date(nowMs - 60_000).toISOString();
}

function createOpenAiDeviceAuthorizationPendingState(input: {
  expiryScenario: DeviceAuthorizationExpiryScenario;
  methods: readonly IntegrationConnectionMethod[];
}): IntegrationConnectionDeviceAuthorizationPendingState {
  const { expiryScenario, methods } = input;
  const method = methods.find(isOpenAiDeviceAuthorizationMethod);
  if (method === undefined) {
    throw new Error("OpenAI device authorization method is required for this story.");
  }

  return {
    targetKey: "openai-default",
    attemptId: "ida_storybook_openai",
    verificationUrl: "https://auth.openai.com/codex/device",
    userCode: "583Q-YMY3G",
    expiresAt: createStoryDeviceAuthorizationExpiresAt(expiryScenario),
    pollAfterMs: 2_000,
    method,
  };
}

export function createAvailableCardsOverview(): readonly OrganizationIntegrationsSettingsPageCard[] {
  return listBrowserIntegrationDefinitions()
    .map(createAvailableCardOverview)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function createAvailableCardOverview(
  definition: AnyIntegrationDefinition,
): OrganizationIntegrationsSettingsPageCard {
  return {
    actionLabel: "Add",
    configStatus: "valid",
    description: resolveDescriptionOrThrow(definition),
    displayName: definition.displayName,
    integrationKind: definition.kind,
    ...(definition.logoKey === undefined ? {} : { logoKey: definition.logoKey }),
    actionHref: `/integrations/${definition.variantId}/add`,
    targetKey: definition.variantId,
  };
}

export function IntegrationSettingsAddFlowStory(spec: StoryIntegrationSpec): React.JSX.Element {
  const initialEditorInput = createEditorInput(spec);
  const defaultMethodId =
    spec.initialMethodId ??
    resolveDefaultMethodId(
      resolveConnectionMethodsOrThrow(getStoryDefinitionOrThrow(spec.variantId)),
    );
  const initialState = createInitialIntegrationConnectionEditorState({
    defaultMethodId,
    initialEditorInput,
  });
  const startsWithoutSelectedMethod =
    initialEditorInput.methods.length > 1 && spec.initialMethodId === undefined;
  const [draft, setDraft] = useState(() => ({
    ...initialState.draft,
    connectionDisplayNameValue: spec.initialConnectionDisplayNameValue ?? "",
    error: spec.connectError ?? initialState.draft.error,
    methodId: startsWithoutSelectedMethod ? "" : initialState.draft.methodId,
    secrets: spec.initialSecrets ?? initialState.draft.secrets,
  }));
  const [deviceAuthorizationPending, setDeviceAuthorizationPending] =
    useState<IntegrationConnectionDeviceAuthorizationPendingState | null>(() =>
      spec.initialDeviceAuthorizationPending === true
        ? createOpenAiDeviceAuthorizationPendingState({
            expiryScenario: spec.deviceAuthorizationExpiryScenario ?? "active",
            methods: initialEditorInput.methods,
          })
        : null,
    );

  const editor = initialState.editor;
  const configForm =
    draft.methodId.length === 0
      ? {
          mode: "none" as const,
        }
      : resolveConnectionMethodFormUiModel({
          editor,
          methodId: draft.methodId,
          currentValue: draft.configValue,
        });

  return (
    <PageFrame
      width="form"
      description={initialEditorInput.targetKey}
      title={`Add ${initialEditorInput.targetDisplayName} Connection`}
    >
      <div className="flex flex-col gap-4">
        <IntegrationConnectionEditorPage
          configForm={configForm}
          configValue={draft.configValue}
          closeDisabled={spec.pending ?? false}
          connectionDisplayNamePlaceholder={draft.connectionDisplayNamePlaceholder}
          connectionDisplayNameValue={draft.connectionDisplayNameValue}
          connectError={draft.error}
          deviceAuthorizationPending={deviceAuthorizationPending}
          editor={editor}
          hasChanges={hasIntegrationConnectionEditorChanges({
            changedSecretNames: [],
            editor,
            configValue: draft.configValue,
            connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
            connectionDisplayNameValue: draft.connectionDisplayNameValue,
            initialConfigValue: draft.initialConfigValue,
            secrets: draft.secrets,
          })}
          isConnectionDisplayNameChanged={isIntegrationConnectionDisplayNameChanged({
            editor,
            connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
            connectionDisplayNameValue: draft.connectionDisplayNameValue,
          })}
          methodId={draft.methodId}
          changedSecretNames={[]}
          onClose={() => {
            setDeviceAuthorizationPending(null);
          }}
          onConfigChange={(value) => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              configValue: value,
              error: null,
            }));
          }}
          onConnectionDisplayNameChange={(value) => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              connectionDisplayNameValue: value,
              error: null,
            }));
          }}
          onMethodChange={(methodId) => {
            setDeviceAuthorizationPending(null);
            setDraft((currentDraft) =>
              resolveNextDraftForMethodChange({
                editor,
                nextMethodId: methodId,
                currentDraft,
              }),
            );
          }}
          onSecretChange={(name, value) => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              error: null,
              secrets: {
                ...currentDraft.secrets,
                [name]: value,
              },
            }));
          }}
          onSubmit={() => {
            const validationError =
              draft.methodId.length === 0
                ? "Authentication method is required."
                : (resolveIntegrationConnectionEditorValidationError({
                    editor,
                    methodId: draft.methodId,
                    connectionDisplayNameValue: draft.connectionDisplayNameValue,
                    secrets: draft.secrets,
                  }) ?? null);

            if (validationError === null && spec.startDeviceAuthorizationOnSubmit === true) {
              setDeviceAuthorizationPending(
                createOpenAiDeviceAuthorizationPendingState({
                  expiryScenario: spec.deviceAuthorizationExpiryScenario ?? "active",
                  methods: initialEditorInput.methods,
                }),
              );
            }

            setDraft((currentDraft) => ({
              ...currentDraft,
              error: validationError,
            }));
          }}
          pending={spec.pending ?? false}
          secrets={draft.secrets}
        />
      </div>
    </PageFrame>
  );
}

export const AddFlowStorySpecs = {
  GitHubEnterpriseServer: {
    variantId: "github-enterprise-server",
  },
  Linear: {
    variantId: "linear-default",
  },
  SigNoz: {
    initialConnectionDisplayNameValue: "SigNoz Cloud",
    variantId: "signoz-mcp",
  },
  OpenAI: {
    variantId: "openai-default",
  },
  OpenAIDeviceAuthorizationFailed: {
    connectError: "The device authorization attempt expired before approval completed.",
    initialConnectionDisplayNameValue: "openai-default",
    initialMethodId: "chatgpt-device-code",
    variantId: "openai-default",
  },
  OpenAIDeviceAuthorizationExpired: {
    deviceAuthorizationExpiryScenario: "expired",
    initialConnectionDisplayNameValue: "openai-default",
    initialDeviceAuthorizationPending: true,
    initialMethodId: "chatgpt-device-code",
    variantId: "openai-default",
  },
  OpenAIDeviceAuthorizationExpiringSoon: {
    deviceAuthorizationExpiryScenario: "expiringSoon",
    initialConnectionDisplayNameValue: "openai-default",
    initialDeviceAuthorizationPending: true,
    initialMethodId: "chatgpt-device-code",
    variantId: "openai-default",
  },
  OpenAIDeviceAuthorizationPending: {
    deviceAuthorizationExpiryScenario: "active",
    initialConnectionDisplayNameValue: "openai-default",
    initialDeviceAuthorizationPending: true,
    initialMethodId: "chatgpt-device-code",
    variantId: "openai-default",
  },
  OpenAIDeviceAuthorizationStart: {
    initialConnectionDisplayNameValue: "openai-default",
    initialMethodId: "chatgpt-device-code",
    startDeviceAuthorizationOnSubmit: true,
    variantId: "openai-default",
  },
} satisfies Record<string, StoryIntegrationSpec>;
