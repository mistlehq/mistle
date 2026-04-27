import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import { createOpenAiRawBindingCapabilitiesByConnectionMethod } from "@mistle/integrations-definitions/openai";
import { useState } from "react";
import type React from "react";

import {
  IntegrationConnectionEditorPage,
  type IntegrationConnectionMethodId,
} from "../integrations/integration-connection-editor.js";
import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";
import { FormPageFrame } from "../shared/page-frame.js";
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
  | "openai-default";

type StoryIntegrationSpec = {
  connectError?: string | null;
  initialConnectionDisplayNameValue?: string;
  initialMethodId?: IntegrationConnectionMethodId;
  initialSecrets?: Record<string, string>;
  pending?: boolean;
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

  return getDefinitionOrThrow({
    familyId: "openai",
    variantId,
  });
}

function resolveConnectionMethodsOrThrow(
  definition: AnyIntegrationDefinition,
): readonly IntegrationConnectionMethod[] {
  if (definition.connectionMethods === undefined || definition.connectionMethods.length === 0) {
    throw new Error(
      `Integration definition '${definition.familyId}/${definition.variantId}' has no connection methods.`,
    );
  }

  return definition.connectionMethods.map((method) => {
    if (method.kind === "form") {
      return {
        id: method.id,
        kind: method.kind,
        label: method.label,
        secretFields: method.secretFields.map((secretField) => ({
          description: secretField.description,
          inputType: secretField.inputType,
          label: secretField.label,
          name: secretField.name,
          placeholder: secretField.placeholder,
        })),
      };
    }

    return {
      id: method.id,
      kind: method.kind,
      label: method.label,
      ui: method.ui,
    };
  });
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
      binding_capabilities_by_connection_method:
        createOpenAiRawBindingCapabilitiesByConnectionMethod(),
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

export function createAvailableCardsOverview(): readonly OrganizationIntegrationsSettingsPageCard[] {
  const specs: readonly StoryIntegrationSpec[] = [
    { variantId: "jira-default" },
    { variantId: "github-cloud" },
    { variantId: "github-enterprise-server" },
    { variantId: "linear-default" },
    { variantId: "openai-default" },
  ];

  return specs.map((spec) => {
    const definition = getStoryDefinitionOrThrow(spec.variantId);

    return {
      actionLabel: "Add",
      configStatus: "valid",
      description: resolveDescriptionOrThrow(definition),
      displayName: definition.displayName,
      ...(definition.logoKey === undefined ? {} : { logoKey: definition.logoKey }),
      onAction: () => {},
      targetKey: definition.variantId,
    };
  });
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
    <FormPageFrame title={`Add ${initialEditorInput.targetDisplayName} Connection`}>
      <div className="flex flex-col gap-4">
        <IntegrationConnectionEditorPage
          configForm={configForm}
          configValue={draft.configValue}
          closeDisabled={spec.pending ?? false}
          connectionDisplayNamePlaceholder={draft.connectionDisplayNamePlaceholder}
          connectionDisplayNameValue={draft.connectionDisplayNameValue}
          connectError={draft.error}
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
          onClose={() => {}}
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
            setDraft((currentDraft) => ({
              ...currentDraft,
              error:
                currentDraft.methodId.length === 0
                  ? "Authentication method is required."
                  : (resolveIntegrationConnectionEditorValidationError({
                      editor,
                      methodId: currentDraft.methodId,
                      connectionDisplayNameValue: currentDraft.connectionDisplayNameValue,
                      secrets: currentDraft.secrets,
                    }) ?? null),
            }));
          }}
          pending={spec.pending ?? false}
          secrets={draft.secrets}
        />
      </div>
    </FormPageFrame>
  );
}

export const AddFlowStorySpecs = {
  GitHubEnterpriseServer: {
    variantId: "github-enterprise-server",
  },
  Jira: {
    variantId: "jira-default",
  },
  Linear: {
    variantId: "linear-default",
  },
  OpenAI: {
    variantId: "openai-default",
  },
} satisfies Record<string, StoryIntegrationSpec>;
